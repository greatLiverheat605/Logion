import hashlib
import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.models import AIProvider, AIRun
from logion_api.ai_gateway.research_context import (
    AI_CONTEXT_ENTITY_TYPES,
    RESEARCH_TASK_TIERS,
    TASK_CONTEXT_ALLOWLIST,
    ContextEntity,
    build_research_context,
)
from logion_api.ai_gateway.research_skills import TASK_SKILLS, load_research_skill
from logion_api.ai_gateway.run_crypto import AIRunInputCipher
from logion_api.ai_gateway.run_schemas import AIRunCreate
from logion_api.ai_gateway.run_service import AIRunService
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


def test_research_allowlists_tiers_and_skill_files_are_an_explicit_contract() -> None:
    assert {
        "resource",
        "source_text",
        "source_excerpt",
        "note",
        "research_question",
        "topic",
        "research_claim",
    } == AI_CONTEXT_ENTITY_TYPES
    assert dict(RESEARCH_TASK_TIERS) == {
        "translate": "economical",
        "weekly_comment": "economical",
        "explain": "quality",
        "close_reading": "quality",
        "quiz_generate": "quality",
        "quiz_grade": "quality",
        "link_suggest": "quality",
    }
    assert set(TASK_CONTEXT_ALLOWLIST) == set(TASK_SKILLS) == set(RESEARCH_TASK_TIERS)
    assert all(
        value == AI_CONTEXT_ENTITY_TYPES
        for task, value in TASK_CONTEXT_ALLOWLIST.items()
        if task != "quiz_grade"
    )
    assert TASK_CONTEXT_ALLOWLIST["quiz_grade"] == {"quiz_attempt", "source_excerpt"}
    assert len(set(TASK_SKILLS.values())) == 5
    for task in TASK_SKILLS:
        assert "untrusted" in load_research_skill(task).lower()
    payload = AIRunCreate(
        id=uuid4(),
        idempotency_key=uuid4(),
        task_type="user.summary",
        target_type="note",
        target_id=uuid4(),
        target_version=1,
        input_fields={"body": "Synthetic"},
        expected_output_fields=["summary"],
        requested_output_tokens=100,
        send_confirmed=True,
    )
    old_hash = hashlib.sha256(
        json.dumps(
            payload.model_dump(mode="json", exclude={"send_confirmed"}),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    assert AIRunService._request_hash(payload) == old_hash


@pytest.mark.asyncio
async def test_builder_refuses_ideas_even_if_allowlist_is_accidentally_widened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "logion_api.ai_gateway.research_context.TASK_CONTEXT_ALLOWLIST",
        {"explain": {"research_idea"}},
    )
    # None proves rejection happens before any database read (and no idea model is imported).
    with pytest.raises(APIError) as error:
        await build_research_context(
            None,
            workspace_id=uuid4(),
            space_id=uuid4(),
            user_id=uuid4(),
            task_type="explain",
            entities=[ContextEntity(entity_type="research_idea", id=uuid4(), version=1)],
        )  # type: ignore[arg-type]
    assert error.value.code == "AI_PRIVATE_CONTENT_BLOCKED"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_ideas_context_routes_and_outbound_defense(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", False)
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.235", 49011)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("192.0.2.236", 49012)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        dummy = f"/api/v1/workspaces/{uuid4()}"
        ideas = f"{dummy}/spaces/{uuid4()}/research/ideas"
        for method, path in [
            ("GET", ideas),
            ("POST", ideas),
            ("GET", f"{ideas}/{uuid4()}"),
            ("PUT", f"{ideas}/{uuid4()}"),
            ("DELETE", f"{ideas}/{uuid4()}"),
            ("GET", f"{dummy}/research/ai/presets"),
            ("POST", f"{dummy}/research/ai/presets"),
            ("POST", f"{dummy}/spaces/{uuid4()}/research/ai/runs"),
        ]:
            assert (await owner.request(method, path, json={})).status_code == 404
        users = []
        for client in (owner, peer):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"research-ai-{uuid4()}@example.com",
                    "password": "synthetic-research-password-123",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
            users.append(UUID(registered.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Synthetic AI space", "visibility": "shared"},
        )
        assert space.status_code == 201, space.text
        space_id = space.json()["id"]
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=users[1],
                    role="editor",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space_id}"
        ideas = f"{scope}/research/ideas"
        presets = f"/api/v1/workspaces/{workspace}/research/ai/presets"
        ai = f"/api/v1/workspaces/{workspace}/ai"
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        private_text = "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND"
        payload = {"title": "Synthetic private hypothesis", "body": private_text}
        assert (
            await owner.post(ideas, json=payload, headers={"X-CSRF-Token": ""})
        ).status_code == 403
        assert (
            await owner.post(
                ideas, json=payload, headers={"Origin": "https://untrusted.example.com"}
            )
        ).status_code == 403
        created = await owner.post(ideas, json=payload)
        assert created.status_code == 201, created.text
        idea_id = created.json()["id"]
        assert created.headers["cache-control"] == "private, no-store"
        assert (await peer.get(ideas)).json()["ideas"] == []
        for method, body in [
            ("GET", None),
            ("PUT", {**payload, "expected_version": 1}),
            ("DELETE", {"expected_version": 1}),
        ]:
            assert (await peer.request(method, f"{ideas}/{idea_id}", json=body)).status_code == 404
        assert (
            await owner.put(
                f"{ideas}/{idea_id}", json={**payload, "status": "archived", "expected_version": 1}
            )
        ).json()["version"] == 2
        assert (
            await owner.put(f"{ideas}/{idea_id}", json={**payload, "expected_version": 1})
        ).status_code == 409
        source = await owner.post(
            f"{scope}/library/resources",
            json={
                "title": "Synthetic published paper",
                "csl": {"abstract": "Public synthetic evidence"},
            },
        )
        assert source.status_code == 201, source.text
        target = {"entity_type": "resource", "id": source.json()["id"], "version": 1}

        def run_body():
            return {
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "task_type": "close_reading",
                "target": target,
                "expected_output_fields": ["summary"],
                "requested_output_tokens": 100,
                "send_confirmed": True,
            }

        run_url = f"{scope}/research/ai/runs"
        blocked = await owner.post(
            run_url,
            json={
                **run_body(),
                "context_entities": [{"entity_type": "research_idea", "id": idea_id, "version": 2}],
            },
        )
        assert blocked.status_code == 403, blocked.text
        assert blocked.json()["code"] == "AI_PRIVATE_CONTENT_BLOCKED"
        legacy_blocked = await owner.post(
            f"{ai}/runs",
            json={
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "task_type": "user.summary",
                "target_type": "idea",
                "target_id": idea_id,
                "target_version": 2,
                "input_fields": {"body": private_text},
                "expected_output_fields": ["summary"],
                "requested_output_tokens": 100,
                "send_confirmed": True,
            },
        )
        assert legacy_blocked.status_code == 403, legacy_blocked.text
        assert legacy_blocked.json()["code"] == "AI_PRIVATE_CONTENT_BLOCKED"
        assert (await peer.post(run_url, json=run_body())).status_code == 404
        provider_id = uuid4()
        provider = await owner.post(
            f"{ai}/providers",
            json={
                "id": str(provider_id),
                "name": "Synthetic research provider",
                "provider_type": "openai_compatible",
                "base_url": "https://api.example.com/v1",
                "credential": uuid4().hex,
                "enabled": True,
                "timeout_seconds": 30,
                "max_retries": 0,
            },
        )
        assert provider.status_code == 201, provider.text
        model_ids = []
        for label in ("economical", "quality"):
            model = await owner.post(
                f"{ai}/models",
                json={
                    "id": str(uuid4()),
                    "provider_id": str(provider_id),
                    "provider_model_id": f"synthetic-{label}",
                    "display_name": label,
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
            model_ids.append(model.json()["id"])
        async with session_factory() as db:
            provider_row = await db.get(AIProvider, provider_id)
            assert provider_row is not None
            provider_row.last_health_status = "healthy"
            await db.commit()
        bad_preset = await owner.post(
            presets,
            json={"economical_model_ids": model_ids[:1], "quality_model_ids": [str(uuid4())]},
        )
        assert bad_preset.status_code == 404, bad_preset.text
        assert (await owner.get(f"{ai}/routes")).json()["routes"] == []
        preset_payload = {"economical_model_ids": model_ids[:1], "quality_model_ids": model_ids[1:]}
        for key in ("economical_model_ids", "quality_model_ids"):
            duplicate = await owner.post(
                presets, json={**preset_payload, key: [model_ids[0], model_ids[0]]}
            )
            assert duplicate.status_code == 422, duplicate.text
            assert (await owner.get(f"{ai}/routes")).json()["routes"] == []
        duplicate_fields = await owner.post(
            run_url, json={**run_body(), "expected_output_fields": ["summary", "summary"]}
        )
        assert duplicate_fields.status_code == 422, duplicate_fields.text
        applied = await owner.post(presets, json=preset_payload)
        assert applied.status_code == 201, applied.text
        assert len(applied.json()["routes"]) == 7
        assert (await owner.post(presets, json=preset_payload)).status_code == 409
        assert len((await owner.get(f"{ai}/routes")).json()["routes"]) == 7
        for task, tier in RESEARCH_TASK_TIERS.items():
            resolved = await owner.post(
                f"{ai}/route-resolution-preview",
                json={
                    "task_type": task,
                    "estimated_input_tokens": 100,
                    "requested_output_tokens": 100,
                },
            )
            assert resolved.status_code == 200, resolved.text
            assert (
                resolved.json()["candidates"][0]["model_id"]
                == model_ids[0 if tier == "economical" else 1]
            )
        outgoing = []

        async def resolve(_host: str, _port: int):
            return ["93.184.216.34"]

        def provider_mock(request: httpx.Request):
            outgoing.append(json.loads(request.content))
            assert private_text not in request.content.decode()
            return httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"summary":"Synthetic draft"}'}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 5},
                },
            )

        execution = AIExecutionService(
            settings,
            adapter_factory=lambda: OpenAICompatibleGenerationAdapter(
                resolver=resolve, transport_factory=lambda: httpx.MockTransport(provider_mock)
            ),
        )
        for mode in ("allowed", "corrupt-builder", "disabled"):
            response = await owner.post(run_url, json=run_body())
            assert response.status_code == 202, response.text
            run_id = UUID(response.json()["id"])
            result_url = f"/api/v1/workspaces/{workspace}/research/ai/runs/{run_id}"
            assert (await owner.get(result_url)).status_code == 200
            assert (await peer.get(result_url)).status_code == 404
            async with session_factory() as db:
                run = await db.get(AIRun, run_id)
                assert run is not None
                run.status = "running"
                if mode == "corrupt-builder":
                    run.context_entity_types = ["research_idea"]
                    encrypted = AIRunInputCipher(settings).encrypt(
                        UUID(workspace), run_id, {"body": private_text}
                    )
                    for name in (
                        "ciphertext",
                        "nonce",
                        "data_key_ciphertext",
                        "data_key_nonce",
                        "encryption_key_id",
                    ):
                        setattr(run, f"input_{name}", getattr(encrypted, name))
                await db.commit()
            if mode == "disabled":
                monkeypatch.setattr(settings, "research_v3_enabled", False)
                assert (await owner.get(result_url)).status_code == 404
            await execution.execute_run(run_id)
            async with session_factory() as db:
                final = await db.get(AIRun, run_id)
                assert final is not None
                assert final.status == ("succeeded" if mode == "allowed" else "failed")
                assert (
                    final.error_code
                    == {
                        "allowed": None,
                        "corrupt-builder": "AI_PRIVATE_CONTENT_BLOCKED",
                        "disabled": "RESEARCH_FEATURE_DISABLED",
                    }[mode]
                )
            assert len(outgoing) == 1
        assert "Close reading" in outgoing[0]["messages"][0]["content"]
        assert "Public synthetic evidence" in outgoing[0]["messages"][1]["content"]
        async with session_factory() as db:
            events = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == users[0],
                        AuditEvent.event_type == "ai.private_content_blocked",
                    )
                )
            )
            assert len(events) == 3
            assert all(
                set(event.event_metadata) == {"task_type", "entity_types"} for event in events
            )
            assert all(event.workspace_id is None and event.target_id is None for event in events)
            assert private_text not in json.dumps([event.event_metadata for event in events])
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        assert (
            await owner.request("DELETE", f"{ideas}/{idea_id}", json={"expected_version": 1})
        ).status_code == 409
        assert (
            await owner.request("DELETE", f"{ideas}/{idea_id}", json={"expected_version": 2})
        ).status_code == 204
        assert (await owner.get(f"{ideas}/{idea_id}")).status_code == 404
