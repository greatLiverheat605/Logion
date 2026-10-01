"""Run the rollback binary against a schema migrated by the forward binary."""

import hashlib
import io
import json
import zipfile
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.models import AIOutputDraft, AIRun, AITaskRoute
from logion_api.ai_gateway.rollback_policy import PRIVATE_TYPES, RESEARCH_TASKS
from logion_api.config import get_settings
from logion_api.content.models import Note, Resource
from logion_api.content.yjs_documents import state_from_markdown
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError
from logion_api.execution.models import Task
from logion_api.main import app
from logion_api.memory.models import MasteryRecord, QuizAttempt, QuizItem, ReviewSchedule, Topic
from logion_api.planning.models import LearningGoal
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.sync.models import ProcessedSyncOperation, SyncChange, WorkspaceSyncState
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import Space, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import select, text

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]
SENTINEL = "ROLLBACK_PRIVATE_RESEARCH_SENTINEL"
PINNED_SCHEMA = json.loads(
    (Path(__file__).resolve().parents[3] / "config/rollback-schema.json").read_text(
        encoding="utf-8"
    )
)


@pytest_asyncio.fixture(loop_scope="session", params=["close_reading", "report", "summary"])
async def rollback_scope(request):
    async with (
        AsyncClient(
            transport=ASGITransport(
                app=app, client=(f"2001:db8::{uuid4().hex[:4]}:{uuid4().hex[:4]}", 49401)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(
                app=app, client=(f"2001:db8::{uuid4().hex[:4]}:{uuid4().hex[:4]}", 49402)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            result = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"rollback-{uuid4()}@example.com",
                    "password": "synthetic-rollback-password-123",
                    "device_name": "synthetic",
                },
            )
            assert result.status_code == 201, result.text
            users.append(UUID(result.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        result = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Rollback compatibility", "visibility": "shared"},
        )
        assert result.status_code == 201, result.text
        space = result.json()["id"]
        common = dict(
            workspace_id=UUID(workspace),
            space_id=UUID(space),
            created_by=users[0],
            updated_by=users[0],
        )
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace), user_id=users[1], role="editor", status="active"
                )
            )
            resources = [
                Resource(
                    **common,
                    research_owner_id=users[0],
                    resource_type=kind,
                    title=SENTINEL,
                    page_index=[],
                )
                for kind in ("paper", "book", "preprint", "web", "link", "pdf_index")
            ]
            shared = Resource(
                **common,
                resource_type="link",
                title="Shared rollback resource",
                source_url="https://example.com/synthetic",
                page_index=[],
            )
            topic = Topic(**common, research_owner_id=users[0], title=SENTINEL)
            goal = LearningGoal(**common, title="Rollback goal", description="", desired_outcome="")
            db.add_all([*resources, shared, topic, goal])
            await db.flush()
            note = Note(
                **common,
                title=SENTINEL,
                markdown_body=SENTINEL,
                yjs_state=state_from_markdown(SENTINEL),
            )
            task = Task(**common, goal_id=goal.id, title=SENTINEL)
            quiz = QuizItem(
                **common,
                topic_id=topic.id,
                prompt=SENTINEL,
                answer_key="Synthetic",
                evaluation_mode="self_assessed",
            )
            db.add_all([note, task, quiz])
            await db.flush()
            params = dict(
                owner=users[0], resource=resources[0].id, note=note.id, task=task.id, quiz=quiz.id
            )
            # New columns deliberately are not mapped by the old application.
            agent_ids = []
            if request.param == "close_reading":
                await db.execute(
                    text(
                        "UPDATE notes SET research_owner_id=:owner, note_kind='close_reading', "
                        "resource_id=:resource WHERE id=:note"
                    ),
                    params,
                )
            else:
                token_id, inbox_id, pending_id = uuid4(), uuid4(), uuid4()
                agent_ids = [token_id, inbox_id, pending_id]
                agent_params = dict(
                    token=token_id,
                    inbox=inbox_id,
                    pending=pending_id,
                    user=users[0],
                    workspace=UUID(workspace),
                    space=UUID(space),
                    digest=hashlib.sha256(str(token_id).encode()).hexdigest(),
                    kind=request.param,
                    payload=json.dumps(
                        {"kind": request.param, "title": SENTINEL, "markdown_body": SENTINEL}
                    ),
                    receipt=json.dumps({"entity_type": "note", "id": str(note.id)}),
                    note=note.id,
                )
                await db.execute(
                    text(
                        "INSERT INTO agent_tokens (id,user_id,workspace_id,space_id,name,"
                        "token_digest,scopes,created_at,expires_at) VALUES "
                        "(:token,:user,:workspace,:space,'Synthetic rollback Agent',:digest,"
                        "jsonb_build_array('read','inbox:write'),now(),now()+interval '1 day')"
                    ),
                    agent_params,
                )
                await db.execute(
                    text(
                        "INSERT INTO agent_inbox_items (id,token_id,user_id,workspace_id,"
                        "space_id,submission_key,kind,payload,payload_digest,status,"
                        "accepted_payload,receipt,decision_digest,created_at,decided_at) "
                        "VALUES (:inbox,:token,:user,:workspace,:space,'accepted',:kind,"
                        "CAST(:payload AS jsonb),:digest,'accepted',CAST(:payload AS jsonb),"
                        "CAST(:receipt AS jsonb),:digest,now(),now())"
                    ),
                    agent_params,
                )
                await db.execute(
                    text(
                        "INSERT INTO agent_inbox_items (id,token_id,user_id,workspace_id,"
                        "space_id,submission_key,kind,payload,payload_digest,created_at) "
                        "VALUES (:pending,:token,:user,:workspace,:space,'pending',:kind,"
                        "CAST(:payload AS jsonb),:digest,now())"
                    ),
                    agent_params,
                )
                await db.execute(
                    text(
                        "UPDATE notes SET research_owner_id=:user, "
                        "agent_inbox_item_id=:inbox WHERE id=:note"
                    ),
                    agent_params,
                )
            await db.execute(
                text(
                    "UPDATE tasks SET research_owner_id=:owner, resource_id=:resource, "
                    "reading_mode='skim', scheduled_on=CURRENT_DATE WHERE id=:task"
                ),
                params,
            )
            await db.execute(
                text(
                    "UPDATE quiz_items SET research_owner_id=:owner, resource_id=:resource, "
                    "origin='user' WHERE id=:quiz"
                ),
                params,
            )
            mastery = MasteryRecord(**common, topic_id=topic.id, user_id=users[0])
            schedule = ReviewSchedule(
                **common,
                topic_id=topic.id,
                user_id=users[0],
                source="manual",
                interval_days=1,
                next_review_at=utc_now(),
            )
            attempt = QuizAttempt(
                **common,
                topic_id=topic.id,
                quiz_item_id=quiz.id,
                user_id=users[0],
                response_text=SENTINEL,
                is_correct=False,
                confidence=1,
                duration_seconds=1,
            )
            db.add_all([mastery, schedule, attempt])
            await db.flush()
            protected = {
                "resource": resources[0].id,
                "note": note.id,
                "task": task.id,
                "topic": topic.id,
                "quiz_item": quiz.id,
                "mastery_record": mastery.id,
                "review_schedule": schedule.id,
                "quiz_attempt": attempt.id,
            }
            private_ids = [*(r.id for r in resources), *protected.values(), *agent_ids]
            await db.commit()
        yield owner, peer, users, workspace, space, protected, private_ids, shared.id


async def test_rollback_hides_private_rows_from_reads_writes_sync_and_exports(rollback_scope):
    owner, peer, users, workspace, space, protected, private_ids, shared_id = rollback_scope
    scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
    sync = f"/api/v1/workspaces/{workspace}/sync"
    for client, user in zip((owner, peer), users, strict=True):
        for suffix in ("topics", "quiz-items", "quiz-attempts", "error-patterns"):
            response = await client.get(scope + "/" + suffix)
            assert response.status_code == 200, response.text
            assert SENTINEL not in response.text
            assert all(str(identity) not in response.text for identity in private_ids)
        for kind, identity in protected.items():
            response = await client.get(sync + f"/deletion-preview/{kind}/{identity}")
            expected = 404 if kind in {"task", "note", "topic", "quiz_item"} else 422
            assert response.status_code == expected, (kind, response.text)
        for kind, body in (
            ("note", {"expected_version": 1, "title": "Overwrite", "markdown_body": "Overwrite"}),
            (
                "resource",
                {
                    "expected_version": 1,
                    "resource_type": "link",
                    "title": "Overwrite",
                    "source_url": "https://example.com/synthetic",
                },
            ),
        ):
            response = await client.put(scope + f"/{kind}s/{protected[kind]}", json=body)
            assert response.status_code == 404, response.text
        response = await client.post(
            f"/api/v1/workspaces/{workspace}/search", json={"query": SENTINEL}
        )
        assert response.status_code == 200 and SENTINEL not in response.text, response.text
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device = next(row["id"] for row in devices if row["current"])
        response = await client.post(
            sync + "/bootstrap",
            json={
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": workspace,
                "device_id": device,
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            },
        )
        assert response.status_code == 200, response.text
        boot = response.json()
        assert str(shared_id) in response.text
        assert all(str(identity) not in response.text for identity in private_ids)
        for kind, identity in protected.items():
            for operation, version in (("update", 0), ("update", 1), ("delete", 1), ("restore", 1)):
                payload = {"space_id": space, "title": "Overwrite"} if operation == "update" else {}
                response = await client.post(
                    sync + "/push",
                    headers={"X-Logion-Sync-Capabilities": "entity-deletion-v1"},
                    json={
                        "message_type": "push_request",
                        "protocol_version": "sync-v1",
                        "workspace_id": workspace,
                        "device_id": device,
                        "sync_epoch": boot["sync_epoch"],
                        "operations": [
                            {
                                "operation_id": str(uuid4()),
                                "protocol_version": "sync-v1",
                                "workspace_id": workspace,
                                "device_id": device,
                                "entity_type": kind,
                                "entity_id": str(identity),
                                "operation_type": operation,
                                "base_version": version,
                                "client_occurred_at": utc_now().isoformat(),
                                "payload": payload,
                                "payload_hash": canonical_hash(payload),
                                "dependencies": [],
                            }
                        ],
                    },
                )
                assert response.status_code == 200, response.text
                result = response.json()["results"][0]
                assert result["status"] == "rejected", result
                assert "conflict" not in result and SENTINEL not in response.text
        async with session_factory() as db:
            archive = await object.__new__(PortabilityService)._build_archive(
                db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
            )
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                data = bundle.read("data.json").decode()
            assert str(shared_id) in data
            assert SENTINEL not in data and all(
                str(identity) not in data for identity in private_ids
            )


async def test_rollback_filters_retained_private_sync_changes_and_tombstones(rollback_scope):
    owner, peer, _users, workspace, _space, protected, private_ids, _shared = rollback_scope
    async with session_factory() as db:
        state = await db.get(WorkspaceSyncState, UUID(workspace))
        if state is None:
            state = WorkspaceSyncState(workspace_id=UUID(workspace))
            db.add(state)
            await db.flush()
        for deleted in (False, True):
            for kind, identity in protected.items():
                state.last_sequence += 1
                operation_id = uuid4()
                payload = {} if deleted else {"title": SENTINEL}
                operation = "delete" if deleted else "update"
                db.add(
                    ProcessedSyncOperation(
                        operation_id=operation_id,
                        workspace_id=state.workspace_id,
                        device_id=uuid4(),
                        entity_type=kind,
                        entity_id=identity,
                        operation_type=operation,
                        payload_hash=canonical_hash(payload),
                        operation_fingerprint=canonical_hash(payload),
                    )
                )
                await db.flush()
                db.add(
                    SyncChange(
                        workspace_id=state.workspace_id,
                        sync_epoch=state.sync_epoch,
                        sequence=state.last_sequence,
                        operation_id=operation_id,
                        entity_type=kind,
                        entity_id=identity,
                        operation_type=operation,
                        server_version=2,
                        occurred_at=utc_now(),
                        tombstone=deleted,
                        deleted_at=utc_now() if deleted else None,
                        payload=payload,
                        payload_hash=canonical_hash(payload),
                    )
                )
        # Retained deleted identities must be filtered, too.
        for kind, model in (
            ("resource", Resource),
            ("note", Note),
            ("task", Task),
            ("topic", Topic),
            ("quiz_item", QuizItem),
            ("mastery_record", MasteryRecord),
            ("review_schedule", ReviewSchedule),
            ("quiz_attempt", QuizAttempt),
        ):
            row = await db.get(model, protected[kind])
            row.deleted_at = utc_now()
        epoch = str(state.sync_epoch)
        await db.commit()
    for client in (owner, peer):
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device = next(row["id"] for row in devices if row["current"])
        response = await client.post(
            f"/api/v1/workspaces/{workspace}/sync/pull",
            json={
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": workspace,
                "device_id": device,
                "sync_epoch": epoch,
                "cursor": 0,
                "limit": 1000,
            },
        )
        assert response.status_code == 200, response.text
        assert SENTINEL not in response.text
        assert all(str(identity) not in response.text for identity in private_ids)


@pytest.mark.parametrize("space_status", ["archived", "deleted"])
async def test_rollback_hides_shared_content_in_inactive_spaces(rollback_scope, space_status):
    owner, peer, _users, workspace, space, _protected, _private_ids, shared_id = rollback_scope
    scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
    sync = f"/api/v1/workspaces/{workspace}/sync"
    sentinel = "ROLLBACK_INACTIVE_SPACE_SENTINEL"
    note_id, topic_id = uuid4(), uuid4()
    identities = (shared_id, note_id, topic_id)
    resource_body = {
        "expected_version": 1,
        "resource_type": "link",
        "title": sentinel,
        "source_url": "https://example.com/synthetic",
    }
    response = await owner.put(scope + f"/resources/{shared_id}", json=resource_body)
    assert response.status_code == 200, response.text
    resource_body["expected_version"] = response.json()["version"]
    for suffix, body in (
        ("notes", {"id": str(note_id), "title": sentinel, "markdown_body": sentinel}),
        ("topics", {"id": str(topic_id), "title": sentinel}),
    ):
        response = await owner.post(scope + "/" + suffix, json=body)
        assert response.status_code == 201, response.text

    # Old REST writes do not append sync changes. Seed retained forward-era changes.
    async with session_factory() as db:
        state = WorkspaceSyncState(workspace_id=UUID(workspace))
        db.add(state)
        await db.flush()
        for kind, identity in zip(("resource", "note", "topic"), identities, strict=True):
            state.last_sequence += 1
            operation_id = uuid4()
            payload = {"space_id": space, "title": sentinel}
            db.add(
                ProcessedSyncOperation(
                    operation_id=operation_id,
                    workspace_id=state.workspace_id,
                    device_id=uuid4(),
                    entity_type=kind,
                    entity_id=identity,
                    operation_type="update",
                    payload_hash=canonical_hash(payload),
                    operation_fingerprint=canonical_hash(payload),
                )
            )
            await db.flush()
            db.add(
                SyncChange(
                    workspace_id=state.workspace_id,
                    sync_epoch=state.sync_epoch,
                    sequence=state.last_sequence,
                    operation_id=operation_id,
                    entity_type=kind,
                    entity_id=identity,
                    operation_type="update",
                    server_version=1,
                    occurred_at=utc_now(),
                    tombstone=False,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        await db.commit()

    bootstraps = []
    for client in (owner, peer):
        response = await client.get(scope + "/topics")
        assert response.status_code == 200 and sentinel in response.text, response.text
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device = next(row["id"] for row in devices if row["current"])
        request = {
            "message_type": "bootstrap_request",
            "protocol_version": "sync-v1",
            "workspace_id": workspace,
            "device_id": device,
            "known_sync_epoch": None,
            "snapshot_id": None,
            "chunk_index": None,
        }
        response = await client.post(sync + "/bootstrap", json=request)
        assert response.status_code == 200, response.text
        boot = response.json()
        assert boot["chunk_count"] == 1
        assert sentinel in response.text
        assert all(str(identity) in response.text for identity in identities)
        pull = {
            "message_type": "pull_request",
            "protocol_version": "sync-v1",
            "workspace_id": workspace,
            "device_id": device,
            "sync_epoch": boot["sync_epoch"],
            "cursor": 0,
            "limit": 1000,
        }
        response = await client.post(sync + "/pull", json=pull)
        assert response.status_code == 200, response.text
        assert response.json()["has_more"] is False
        assert sentinel in response.text
        assert all(str(identity) in response.text for identity in identities)
        bootstraps.append((client, request, pull))

    # Only the Space changes; retained shared rows and old sync payloads remain intact.
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        row.status = space_status
        row.deleted_at = utc_now() if space_status == "deleted" else None
        await db.commit()

    for client, request, pull in bootstraps:
        responses = [
            await client.get(scope + "/topics"),
            await client.put(scope + f"/resources/{shared_id}", json=resource_body),
            await client.put(
                scope + f"/notes/{note_id}",
                json={"expected_version": 1, "title": "Overwrite", "markdown_body": "Overwrite"},
            ),
            await client.post(scope + "/notes", json={"id": str(uuid4()), "title": "New note"}),
        ]
        assert all(response.status_code == 404 for response in responses), [
            response.text for response in responses
        ]
        snapshot = await client.post(sync + "/bootstrap", json=request)
        assert snapshot.status_code == 200, snapshot.text
        assert snapshot.json()["chunk_count"] == 1
        delta = await client.post(sync + "/pull", json=pull)
        assert delta.status_code == 200, delta.text
        assert delta.json()["has_more"] is False
        search = await client.post(
            f"/api/v1/workspaces/{workspace}/search", json={"query": sentinel}
        )
        assert search.status_code == 200, search.text
        for response in (*responses, snapshot, delta, search):
            assert sentinel not in response.text
            assert all(str(identity) not in response.text for identity in identities)

    async with session_factory() as db:
        resource = await db.get(Resource, shared_id)
        note = await db.get(Note, note_id)
        topic = await db.get(Topic, topic_id)
        assert resource.title == note.title == topic.title == sentinel
        assert note.markdown_body == sentinel and note.version == 1
        assert resource.version == resource_body["expected_version"]
        assert all(row.deleted_at is None for row in (resource, note, topic))


async def test_rollback_research_jobs_remain_queued_and_inaccessible(rollback_scope):
    owner, peer, users, workspace, _space, protected, _private_ids, _shared = rollback_scope
    runs = []
    drafts = []
    async with session_factory() as db:
        route = AITaskRoute(
            workspace_id=UUID(workspace),
            name="Synthetic",
            normalized_name="synthetic",
            task_type="user.structured-draft",
            max_input_tokens=4000,
            max_output_tokens=100,
            created_by=users[0],
            updated_by=users[0],
        )
        db.add(route)
        await db.flush()
        cases = (
            [dict(task_type=task) for task in RESEARCH_TASKS]
            + [dict(target_type=kind) for kind in PRIVATE_TYPES]
            + [
                dict(context_entity_types=["resource"]),
                dict(context_entity_types=["ReSeArCh_IdEaS"]),
                dict(prompt_version="research-v1/translate"),
            ]
            + [
                dict(target_type=kind, target_id=identity)
                for kind, identity in protected.items()
                if kind in {"resource", "note", "topic", "task", "quiz_item", "quiz_attempt"}
            ]
        )
        for changes in cases:
            fields = dict(
                workspace_id=UUID(workspace),
                route_id=route.id,
                task_type="user.structured-draft",
                target_type="note",
                target_id=uuid4(),
                target_version=1,
                selected_fields=["note"],
                context_entity_types=[],
                expected_output_fields=["summary"],
                prompt_version="structured-draft-v1",
                prompt_hash="0" * 64,
                idempotency_key=uuid4(),
                request_hash="1" * 64,
                status="queued",
                estimated_input_tokens=1,
                requested_output_tokens=1,
                reserved_tokens=2,
                reserved_cost_minor=0,
                currency="USD",
                requested_by=users[0],
            )
            run = AIRun(**{**fields, **changes})
            db.add(run)
            await db.flush()
            draft = AIOutputDraft(
                workspace_id=UUID(workspace),
                run_id=run.id,
                target_type=run.target_type,
                target_id=run.target_id,
                target_version=1,
                structured_output={"summary": SENTINEL},
            )
            db.add(draft)
            await db.flush()
            runs.append(run.id)
            drafts.append(draft.id)
        await db.commit()

    def no_adapter():
        pytest.fail("Rollback must never construct a provider adapter for research data")

    service = AIExecutionService(get_settings(), adapter_factory=no_adapter)
    assert await service.execute_next() is False
    for identity in runs:
        with pytest.raises(APIError, match="unavailable during rollback"):
            await service.execute_run(identity)
    for client in (owner, peer):
        base = f"/api/v1/workspaces/{workspace}/ai"
        for suffix in ("runs", "drafts"):
            response = await client.get(base + "/" + suffix)
            assert response.status_code == 200, response.text
            assert response.json()[suffix] == []
        for identity in runs:
            response = await client.post(
                base + f"/runs/{identity}/cancel", json={"expected_version": 1}
            )
            assert response.status_code == 404, response.text
        # A colliding identifier cannot replay or expose a research run through old create.
        response = await client.post(
            base + "/runs",
            json={
                "id": str(runs[0]),
                "idempotency_key": str(uuid4()),
                "task_type": "user.structured-draft",
                "target_type": "note",
                "target_id": str(uuid4()),
                "target_version": 1,
                "input_fields": {"note": "Synthetic"},
                "expected_output_fields": ["summary"],
                "requested_output_tokens": 1,
                "send_confirmed": True,
            },
        )
        assert response.status_code == 404, response.text
        for identity in drafts:
            response = await client.post(
                base + f"/drafts/{identity}/decision",
                json={"expected_version": 1, "decision": "accepted"},
            )
            assert response.status_code == 404, response.text
    async with session_factory() as db:
        stored = list(await db.scalars(select(AIRun).where(AIRun.id.in_(runs))))
        assert len(stored) == len(runs)
        assert all(
            row.status == "queued" and row.attempt_count == 0 and row.version == 1 for row in stored
        )


async def test_rollback_export_format_and_current_space_access(rollback_scope):
    owner, peer, users, workspace, space, _protected, _private_ids, _shared = rollback_scope
    service = PortabilityService(get_settings(), WorkspaceService(get_settings()))
    future_id = uuid4()
    async with session_factory() as db:
        db.add(
            DataExportJob(
                id=future_id,
                workspace_id=UUID(workspace),
                requested_by=users[0],
                schema_version="logion-export-v03",
                expires_at=utc_now() + timedelta(hours=1),
            )
        )
        await db.commit()
    assert await service.execute_next() is False
    base = f"/api/v1/workspaces/{workspace}/data-exports"
    for client in (owner, peer):
        assert (await client.get(base)).json()["exports"] == []
        assert (await client.get(base + f"/{future_id}/download")).status_code == 404
        assert (
            await client.post(base, json={"id": str(future_id), "confirmation": "EXPORT"})
        ).status_code == 404
        assert (
            await client.post(base + f"/{future_id}/cancel", json={"expected_version": 1})
        ).status_code == 404
    identity = uuid4()
    response = await peer.post(base, json={"id": str(identity), "confirmation": "EXPORT"})
    assert response.status_code == 202, response.text
    assert await service.execute_next() is True
    assert (await peer.get(base + f"/{identity}/download")).status_code == 200
    async with session_factory() as db:
        row = await db.get(Space, UUID(space))
        row.visibility = "private"
        row.owner_user_id = users[0]
        await db.commit()
    response = await peer.get(base + f"/{identity}/download")
    assert response.status_code == 409 and response.json()["code"] == "EXPORT_SCOPE_CHANGED", (
        response.text
    )
    async with session_factory() as db:
        row = await db.get(DataExportJob, future_id)
        assert row.status == "queued" and row.version == 1


async def test_rollback_schema_preflight_is_read_only_and_requires_exact_head():
    from logion_api.db import engine
    from logion_api.rollback import verify_schema

    expected = PINNED_SCHEMA["migration_head"]
    async with engine.connect() as connection:
        result = await verify_schema(connection, expected)
        assert result["status"] == "passed" and result["read_only"] is True
        assert await connection.scalar(text("SHOW transaction_read_only")) == "on"
    async with engine.connect() as connection:
        with pytest.raises(ValueError, match="exact schema head"):
            await verify_schema(connection, "0043_workspace_invitation_email")


async def test_rollback_agent_endpoints_are_unavailable(rollback_scope):
    owner, peer, _users, workspace, space, protected, _private_ids, _shared = rollback_scope
    for client in (owner, peer):
        for path in (
            "/api/v1/research/agent-tokens",
            "/api/v1/agent/context",
            f"/api/v1/workspaces/{workspace}/spaces/{space}/agent-inbox",
            f"/api/v1/workspaces/{workspace}/spaces/{space}/agent-inbox/notes/{protected['note']}",
        ):
            response = await client.get(path)
            assert response.status_code == 404, response.text
            assert SENTINEL not in response.text
