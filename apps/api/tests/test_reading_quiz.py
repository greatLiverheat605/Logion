import importlib.util
import io
import json
import zipfile
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.models import AIProvider, AIRun, AIUsageMonthly
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import engine, session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.models import AuthSession
from logion_api.main import app
from logion_api.memory.models import MasteryRecord, QuizAttempt
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.reading.quiz_types import parse_grade, parse_questions
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import Connection, inspect, select, update
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0052_reading_quizzes.py"


def questions() -> dict[str, str]:
    return {
        "questions": json.dumps(
            [
                {
                    "prompt": f"Explain synthetic angle {i}.",
                    "answer_key": f"Reference answer {i}",
                    "explanation": "Supported by [source_1]",
                    "concept": f"Synthetic concept {i}",
                }
                for i in range(5)
            ]
        )
    }


def test_quiz_output_rejects_extra_fields_and_invalid_evidence() -> None:
    assert len(parse_questions(questions())) == 5
    for value in (
        {"questions": "[]"},
        {"questions": "not json"},
        {"questions": json.dumps([{"prompt": "x"}] * 5)},
        {**questions(), "mastery": "mastered"},
    ):
        with pytest.raises(APIError):
            parse_questions(value)
    for score in (-1, 101, True, "100"):
        with pytest.raises(APIError):
            parse_grade(
                {
                    "grade": json.dumps(
                        {"score": score, "reasoning": "Evidence", "weak_concepts": []}
                    )
                }
            )
    with pytest.raises(APIError):
        parse_grade(
            {
                "grade": json.dumps(
                    {
                        "score": 100,
                        "reasoning": "Evidence",
                        "weak_concepts": [],
                        "mastery": "mastered",
                    }
                )
            }
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quiz_draft_attempt_grade_owner_confirmation_and_legacy_isolation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.244", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.245", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"quiz-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (
            await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={"name": "Reading quizzes", "visibility": "shared"},
            )
        ).json()["id"]
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        resource = (
            await owner.post(
                f"{scope}/library/resources",
                json={"title": "Synthetic private quiz paper", "resource_type": "paper"},
            )
        ).json()
        path = f"{scope}/library/resources/{resource['id']}"
        quiz = f"{path}/quiz"
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=users[1],
                    role="admin",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            row = await db.get(Resource, UUID(resource["id"]))
            assert row
            row.sha256 = "a" * 64
            await db.commit()
        source = (
            await owner.post(
                f"{path}/text",
                json={
                    "file_sha256": "a" * 64,
                    "pages": ["Synthetic public source evidence."],
                    "extracted_by": "pdfjs@6.3.289",
                },
            )
        ).json()
        excerpt = (
            await owner.post(
                f"{path}/excerpts",
                json={"source_text_id": source["id"], "char_start": 0, "char_end": 20},
            )
        ).json()
        idea = (
            await owner.post(
                f"{scope}/research/ideas",
                json={
                    "title": "Private hypothesis",
                    "body": "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND",
                },
            )
        ).json()
        ai = f"/api/v1/workspaces/{workspace}/ai"
        provider_id = uuid4()
        response = await owner.post(
            f"{ai}/providers",
            json={
                "id": str(provider_id),
                "name": "Synthetic quiz provider",
                "provider_type": "openai_compatible",
                "base_url": "https://api.example.com/v1",
                "credential": uuid4().hex,
                "enabled": True,
                "timeout_seconds": 30,
                "max_retries": 0,
            },
        )
        assert response.status_code == 201, response.text
        model = await owner.post(
            f"{ai}/models",
            json={
                "id": str(uuid4()),
                "provider_id": str(provider_id),
                "provider_model_id": "synthetic-quality",
                "display_name": "Synthetic",
                "enabled": True,
                "supports_json": True,
                "supports_stream": False,
                "context_window": 32000,
                "pricing_currency": "USD",
                "input_cost_per_million_minor": 1,
                "output_cost_per_million_minor": 1,
            },
        )
        assert model.status_code == 201, model.text
        async with session_factory() as db:
            provider = await db.get(AIProvider, provider_id)
            assert provider
            provider.last_health_status = "healthy"
            await db.commit()
        response = await owner.post(
            f"/api/v1/workspaces/{workspace}/research/ai/presets",
            json={
                "economical_model_ids": [model.json()["id"]],
                "quality_model_ids": [model.json()["id"]],
            },
        )
        assert response.status_code == 201, response.text
        outgoing = []
        output_override = None

        async def resolve(_host: str, _port: int):
            return ["93.184.216.34"]

        def provider_mock(request: httpx.Request):
            assert "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND" not in request.content.decode()
            request_data = json.loads(request.content)
            data = json.loads(request_data["messages"][1]["content"])
            outgoing.append(data)
            output = output_override or (
                questions()
                if data["requested_output_fields"] == ["questions"]
                else {
                    "grade": json.dumps(
                        {
                            "score": 80,
                            "reasoning": "Evidence supports the answer [source_1].",
                            "weak_concepts": ["Limits"],
                        }
                    )
                }
            )
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": json.dumps(output)}}],
                    "usage": {"prompt_tokens": 40, "completion_tokens": 30},
                },
            )

        execution = AIExecutionService(
            settings,
            adapter_factory=lambda: OpenAICompatibleGenerationAdapter(
                resolver=resolve, transport_factory=lambda: httpx.MockTransport(provider_mock)
            ),
        )
        run_url = f"{scope}/research/ai/runs"

        def generation():
            return {
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "task_type": "quiz_generate",
                "target": {
                    "entity_type": "resource",
                    "id": resource["id"],
                    "version": resource["version"],
                },
                "context_entities": [
                    {"entity_type": "source_text", "id": source["id"], "version": source["version"]}
                ],
                "expected_output_fields": ["questions"],
                "requested_output_tokens": 1500,
                "send_confirmed": True,
            }

        async def execute(payload):
            response = await owner.post(run_url, json=payload)
            assert response.status_code == 202, response.text
            run_id = UUID(response.json()["id"])
            async with session_factory() as db:
                run = await db.get(AIRun, run_id)
                assert run
                run.status = "running"
                await db.commit()
            await execution.execute_run(run_id)
            response = await owner.get(f"/api/v1/workspaces/{workspace}/research/ai/runs/{run_id}")
            assert response.status_code == 200, response.text
            return response.json()

        result = await execute(generation())
        assert result["run"]["status"] == "succeeded", result
        assert (await owner.get(quiz)).json()["items"] == []
        draft = result["draft"]
        decision = {
            "decision": "accepted",
            "expected_resource_version": resource["version"],
            "expected_draft_version": draft["version"],
        }
        decision_url = f"{quiz}/drafts/{draft['id']}/decision"
        assert (await peer.get(quiz)).status_code == 404
        assert (await peer.post(decision_url, json=decision)).status_code == 404
        for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.example.com"}):
            assert (
                await owner.post(decision_url, json=decision, headers=headers)
            ).status_code == 403
        async with session_factory() as db:
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users[0])
                .values(created_at=utc_now() - timedelta(hours=1))
            )
            await db.commit()
        # ADR-0066: accepting a research draft works throughout a long reading session.
        accepted = await owner.post(decision_url, json=decision)
        async with session_factory() as db:
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users[0])
                .values(created_at=utc_now())
            )
            await db.commit()
        assert accepted.status_code == 200, accepted.text
        assert len(accepted.json()["items"]) == 5 and "answer_key" not in accepted.text
        assert (await owner.post(decision_url, json=decision)).status_code == 409
        item = accepted.json()["items"][0]
        item_url = f"{quiz}/items/{item['id']}"
        assert item["origin"] == "ai" and item["ai_run_id"] == result["run"]["id"]
        assert item["mastery"] is None and item["review_schedule"] is None
        assert (await peer.get(f"{item_url}/answer")).status_code == 404
        assert (await owner.get(f"{item_url}/answer")).json()["answer_key"] == "Reference answer 0"
        attempt_body = {
            "id": str(uuid4()),
            "expected_item_version": item["version"],
            "response_text": "My explanation of the source.",
        }
        attempted = await owner.post(f"{item_url}/attempts", json=attempt_body)
        assert attempted.status_code == 200, attempted.text
        attempt = attempted.json()
        assert attempt["ai_grade"] is None and "answer_key" not in attempt
        assert (await owner.post(f"{item_url}/attempts", json=attempt_body)).json() == attempt
        assert (
            await owner.post(
                f"{item_url}/attempts", json={**attempt_body, "response_text": "Changed"}
            )
        ).status_code == 409
        grade = {
            **generation(),
            "task_type": "quiz_grade",
            "target": {
                "entity_type": "quiz_attempt",
                "id": attempt["id"],
                "version": attempt["version"],
            },
            "context_entities": [
                {
                    "entity_type": "source_excerpt",
                    "id": excerpt["id"],
                    "version": excerpt["version"],
                }
            ],
            "expected_output_fields": ["grade"],
        }
        assert (await peer.post(run_url, json=grade)).status_code == 404
        for kind, identity in (
            ("research_idea", idea["id"]),
            ("note", uuid4()),
            ("source_text", source["id"]),
        ):
            blocked = await owner.post(
                run_url,
                json={
                    **grade,
                    "context_entities": [{"entity_type": kind, "id": str(identity), "version": 1}],
                },
            )
            assert blocked.json()["code"] == (
                "AI_PRIVATE_CONTENT_BLOCKED"
                if kind == "research_idea"
                else "AI_CONTEXT_TYPE_BLOCKED"
            )
        assert (await owner.post(run_url, json={**grade, "task_type": "explain"})).json()[
            "code"
        ] == "AI_CONTEXT_TYPE_BLOCKED"
        result = await execute(grade)
        assert result["run"]["status"] == "succeeded" and result["draft"] is None, result
        graded = (await owner.get(quiz)).json()["items"][0]
        assert graded["latest_attempt"]["ai_grade"]["score"] == 80
        assert graded["mastery"] is None and graded["review_schedule"] is None
        assert "Reference answer 0" in json.dumps(outgoing[-1]) and "My explanation" in json.dumps(
            outgoing[-1]
        )
        confirm = {
            "mastery_id": str(uuid4()),
            "schedule_id": str(uuid4()),
            "expected_version": 0,
            "confirmed_level": "mastered",
        }
        confirmed = await owner.post(f"{item_url}/mastery", json=confirm)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["mastery"]["confirmed_level"] == "mastered"
        assert confirmed.json()["review_schedule"]["interval_days"] == 14
        assert (await owner.post(f"{item_url}/mastery", json=confirm)).status_code == 409
        reviews = (await owner.get(f"{scope}/research/review")).json()["items"]
        assert len(reviews) == 1 and reviews[0]["quiz_item_id"] == item["id"]
        assert (await peer.get(f"{scope}/research/review")).json()["items"] == []
        revised = await owner.post(
            f"{item_url}/mastery",
            json={**confirm, "expected_version": 1, "confirmed_level": "practicing"},
        )
        assert (
            revised.status_code == 200 and revised.json()["review_schedule"]["interval_days"] == 2
        )
        assert revised.json()["review_schedule"]["last_reviewed_at"] is not None
        # Every legacy projection must exclude the private question and its derived records.
        for client, user in ((owner, users[0]), (peer, users[1])):
            for suffix in ("quiz-items", "quiz-attempts", "topics"):
                response = await client.get(f"{scope}/{suffix}")
                assert (
                    response.status_code == 200
                    and item["id"] not in response.text
                    and item["topic_id"] not in response.text
                )
            preview = await client.get(
                f"/api/v1/workspaces/{workspace}/sync/deletion-preview/quiz_item/{item['id']}"
            )
            assert preview.status_code == 404, preview.text
            async with session_factory() as db:
                archive = await object.__new__(PortabilityService)._build_archive(
                    db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
                )
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    data = bundle.read("data.json").decode()
                for identity in (
                    item["id"],
                    item["topic_id"],
                    attempt["id"],
                    confirm["mastery_id"],
                    confirm["schedule_id"],
                ):
                    assert identity not in data
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            bootstrap = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                json={
                    "message_type": "bootstrap_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": next(d["id"] for d in devices if d["current"]),
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200, bootstrap.text
            for identity in (
                item["id"],
                item["topic_id"],
                attempt["id"],
                confirm["mastery_id"],
                confirm["schedule_id"],
            ):
                assert identity not in bootstrap.text
        # Invalid provider evidence consumes measured usage but cannot overwrite evidence/mastery.
        new_attempt = (
            await owner.post(f"{item_url}/attempts", json={**attempt_body, "id": str(uuid4())})
        ).json()
        output_override = {
            "grade": json.dumps({"score": 101, "reasoning": "Invalid", "weak_concepts": []})
        }
        failed = await execute(
            {
                **grade,
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "target": {"entity_type": "quiz_attempt", "id": new_attempt["id"], "version": 1},
            }
        )
        assert (
            failed["run"]["status"] == "failed"
            and failed["run"]["error_code"] == "AI_DRAFT_SCHEMA_INVALID"
        )
        assert failed["run"]["actual_input_tokens"] == 40
        async with session_factory() as db:
            row = await db.get(QuizAttempt, UUID(new_attempt["id"]))
            assert row and row.ai_grade is None
            mastery = await db.get(MasteryRecord, UUID(confirm["mastery_id"]))
            assert mastery and mastery.confirmed_level == "practicing"
            usage = await db.scalar(
                select(AIUsageMonthly).where(AIUsageMonthly.workspace_id == UUID(workspace))
            )
            assert usage and usage.reserved_tokens == 0 and usage.consumed_tokens == 210
        # A malformed or stale generation never creates another set of formal questions.
        output_override = {"questions": "[]"}
        invalid = await execute(generation())
        rejected_format = await owner.post(
            f"{quiz}/drafts/{invalid['draft']['id']}/decision", json=decision
        )
        assert rejected_format.status_code == 422, rejected_format.text
        output_override = None
        stale = await execute(generation())
        changed = await owner.put(
            path,
            json={
                "title": "Revised paper",
                "expected_version": resource["version"],
                "resource_type": "paper",
            },
        )
        assert changed.status_code == 200, changed.text
        refused = await owner.post(
            f"{quiz}/drafts/{stale['draft']['id']}/decision",
            json={**decision, "expected_resource_version": changed.json()["version"]},
        )
        assert refused.status_code == 409, refused.text
        assert (
            await owner.post(
                f"{quiz}/drafts/{stale['draft']['id']}/decision",
                json={**decision, "decision": "rejected"},
            )
        ).status_code == 200
        assert len((await owner.get(quiz)).json()["items"]) == 5
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        for method, url, body in [
            ("GET", quiz, None),
            ("GET", f"{quiz}/ai-runs", None),
            ("GET", f"{item_url}/answer", None),
            ("POST", f"{item_url}/attempts", attempt_body),
            ("POST", f"{item_url}/mastery", confirm),
            ("POST", decision_url, decision),
            ("GET", f"{scope}/research/review", None),
        ]:
            assert (await owner.request(method, url, json=body)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quiz_migration_roundtrip_scope_constraints_and_data_refusal() -> None:
    spec = importlib.util.spec_from_file_location("reading_quiz_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"quiz_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE resources (id uuid, workspace_id uuid, space_id uuid, "
            "research_owner_id uuid, UNIQUE(id,workspace_id,space_id,research_owner_id))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE topics (id uuid PRIMARY KEY, workspace_id uuid, space_id uuid, "
            "research_owner_id uuid)"
        )
        connection.exec_driver_sql("CREATE TABLE ai_runs (id uuid PRIMARY KEY, workspace_id uuid)")
        connection.exec_driver_sql(
            "CREATE TABLE quiz_items (id uuid PRIMARY KEY, workspace_id uuid, "
            "space_id uuid, topic_id uuid)"
        )
        connection.exec_driver_sql("CREATE TABLE quiz_attempts (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "INSERT INTO quiz_items VALUES "
            "(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid())"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert "resource_id" not in {
                c["name"] for c in inspect(connection).get_columns("quiz_items")
            }
            migration.upgrade()
            connection.exec_driver_sql("INSERT INTO users VALUES (gen_random_uuid())")
            connection.exec_driver_sql(
                "INSERT INTO resources SELECT gen_random_uuid(), workspace_id, space_id, "
                "(SELECT id FROM users) FROM quiz_items"
            )
            connection.exec_driver_sql(
                "INSERT INTO topics SELECT topic_id, workspace_id, space_id, "
                "(SELECT id FROM users) FROM quiz_items"
            )
            connection.exec_driver_sql(
                "UPDATE quiz_items SET origin='user',resource_id=(SELECT id FROM resources),"
                "research_owner_id=(SELECT id FROM users)"
            )
            for sql in (
                "UPDATE quiz_items SET origin=NULL",
                "UPDATE quiz_items SET origin='ai'",
                "UPDATE quiz_items SET space_id=gen_random_uuid()",
                "INSERT INTO quiz_attempts VALUES(gen_random_uuid(),'[]'::jsonb)",
            ):
                with connection.begin_nested() as nested:
                    with pytest.raises(IntegrityError):
                        connection.exec_driver_sql(sql)
                    nested.rollback()
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
