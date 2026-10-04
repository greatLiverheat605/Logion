import asyncio
import io
import json
import zipfile
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from logion_api.agents.models import AgentInboxItem, AgentToken
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.models import AIProvider, AIRun
from logion_api.config import get_settings
from logion_api.db import session_factory, utc_now
from logion_api.execution.models import Task
from logion_api.main import app
from logion_api.planning.weekly_schemas import WeeklyReviewCreate, WeeklyStats
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import ValidationError
from sqlalchemy import func, select


def test_weekly_snapshot_schema_has_no_text_extension_or_coercion() -> None:
    stats = dict.fromkeys(WeeklyStats.model_fields, 0)
    WeeklyStats.model_validate(stats)
    for change in ({"planned": True}, {"done": "1"}, {"title": "private"}, {"done": -1}):
        with pytest.raises(ValidationError):
            WeeklyStats.model_validate({**stats, **change})
    for change in ({"week_start": "2026-09-29"}, {"timezone": "not-a-zone"}):
        with pytest.raises(ValidationError):
            WeeklyReviewCreate.model_validate({"week_start": "2026-09-28", **change})


@pytest_asyncio.fixture(loop_scope="session")
async def weekly_scope(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    address = uuid4().int % 65536
    async with (
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=app, client=(f"198.18.{address // 256}.{address % 256}", 47000)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=app, client=(f"198.19.{address // 256}.{address % 256}", 47000)
            ),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"weekly-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "Synthetic weekly test",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (
            await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={
                    "name": "Weekly shared space",
                    "visibility": "shared",
                },
            )
        ).json()["id"]
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
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
            await db.commit()
        goal = str(uuid4())
        response = await owner.post(
            scope + "/goals",
            json={
                "goal_id": goal,
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Reading goal",
                "desired_outcome": "Explain the result",
                "weekly_minutes": 120,
                "phases": [
                    {
                        "id": str(uuid4()),
                        "title": "Read",
                        "position": 0,
                        "estimated_minutes": 120,
                        "acceptance_criteria": ["Write a summary"],
                    }
                ],
            },
        )
        assert response.status_code == 201, response.text
        resource = await owner.post(
            scope + "/library/resources", json={"title": "PRIVATE_PAPER_SENTINEL"}
        )
        assert resource.status_code == 201, resource.text
        yield owner, peer, scope, workspace, users, goal, resource.json()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weekly_triage_private_tasks_stale_snapshot_atomic_rollover(
    weekly_scope, monkeypatch
):
    owner, peer, scope, workspace, _users, goal, resource = weekly_scope
    path = scope + "/research/weekly"
    payload = {
        "title": "PRIVATE_TASK_SENTINEL",
        "goal_id": goal,
        "resource_id": resource["id"],
        "scheduled_on": "2026-09-28",
        "reading_mode": "close_read",
    }
    for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.example.com"}):
        assert (await owner.post(path + "/tasks", json=payload, headers=headers)).status_code == 403
    assert (await peer.post(path + "/tasks", json=payload)).status_code == 404
    tasks = []
    for mode in ("close_read", "close_read", "skim", "close_read"):
        response = await owner.post(path + "/tasks", json={**payload, "reading_mode": mode})
        assert response.status_code == 201, response.text
        tasks.append(response.json())
    params = {"week_start": "2026-09-28"}
    assert (await peer.get(path, params=params)).json()["tasks"] == []
    decision = {"expected_version": 1, "status": "done"}
    assert (
        await peer.post(path + f"/tasks/{tasks[0]['id']}/decision", json=decision)
    ).status_code == 404
    response = await owner.post(path + f"/tasks/{tasks[0]['id']}/decision", json=decision)
    assert response.json()["code"] == "READING_CLOSE_READ_REQUIRED", response.text
    # Skim completion cannot be promoted by AI, and is the owner's explicit reading confirmation.
    completed = await owner.post(path + f"/tasks/{tasks[2]['id']}/decision", json=decision)
    assert completed.status_code == 200, completed.text
    assert (await owner.get(scope + f"/library/resources/{resource['id']}")).json()[
        "reading_status"
    ] == "skimmed"
    response = await owner.post(path + "/reviews", json={**params, "timezone": "Asia/Shanghai"})
    assert response.status_code == 200, response.text
    review = response.json()
    assert review["stats"]["planned"] == 4 and review["stats"]["done"] == 1
    assert (await peer.get(path, params=params)).json()["review"] is None
    close = path + f"/reviews/{review['id']}/close"
    assert (await peer.post(close, json={"expected_version": 1, "triage": []})).status_code == 404
    assert (await owner.post(close, json={"expected_version": 1, "triage": []})).json()[
        "code"
    ] == "WEEKLY_TRIAGE_REQUIRED"
    triage = [
        {"task_id": tasks[index]["id"], "action": action, "reason": "PRIVATE_REASON_SENTINEL"}
        for index, action in ((0, "carry"), (1, "downgrade"), (3, "drop"))
    ]
    duplicate = {"expected_version": 1, "triage": [triage[0], triage[0], triage[2]]}
    assert (await owner.post(close, json=duplicate)).status_code == 409
    changed = await owner.put(
        path + f"/tasks/{tasks[0]['id']}",
        json={**payload, "title": "Updated private title", "expected_version": 1},
    )
    assert changed.status_code == 200, changed.text
    assert (await owner.post(close, json={"expected_version": 1, "triage": triage})).json()[
        "code"
    ] == "WEEKLY_SNAPSHOT_STALE"
    refreshed = await owner.post(
        path + f"/reviews/{review['id']}/refresh", json={"expected_version": 1}
    )
    assert refreshed.status_code == 200, refreshed.text
    body = {"expected_version": refreshed.json()["version"], "triage": triage}
    raced = await asyncio.gather(owner.post(close, json=body), owner.post(close, json=body))
    assert [response.status_code for response in raced] == [200, 200], [r.text for r in raced]
    assert raced[0].json() == raced[1].json()
    next_plan = (await owner.get(path, params={"week_start": "2026-10-05"})).json()
    assert len(next_plan["tasks"]) == 2
    assert sorted(task["reading_mode"] for task in next_plan["tasks"]) == ["close_read", "skim"]
    assert all(task["scheduled_on"] == "2026-10-05" for task in next_plan["tasks"])
    assert len((await owner.get(path, params=params)).json()["tasks"]) == 4
    assert (await owner.post(path + "/tasks", json=payload)).json()[
        "code"
    ] == "WEEKLY_REVIEW_CLOSED"
    assert (await owner.post(path + f"/tasks/{tasks[1]['id']}/decision", json=decision)).json()[
        "code"
    ] == "WEEKLY_REVIEW_CLOSED"
    assert (
        await owner.post(path + f"/reviews/{review['id']}/refresh", json={"expected_version": 3})
    ).status_code == 409
    # Closed plans cannot be modified through legacy endpoints, even by their owner.
    for client in (owner, peer):
        response = await client.post(
            scope + f"/tasks/{tasks[0]['id']}/transition",
            json={"expected_version": 2, "status": "done"},
        )
        assert response.status_code == 404, response.text
        response = await client.post(
            scope + "/sessions", json={"id": str(uuid4()), "task_id": tasks[0]["id"]}
        )
        assert response.status_code == 404, response.text
    monkeypatch.setattr(get_settings(), "research_v3_enabled", False)
    assert (await owner.get(path, params=params)).status_code == 404
    assert (await owner.post(path + "/tasks", json=payload)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weekly_ai_numbers_only_draft_acceptance_and_egress_revalidation(weekly_scope):
    owner, peer, scope, workspace, users, goal, resource = weekly_scope
    path = scope + "/research/weekly"
    today = date.today()
    monday = date.fromordinal(today.toordinal() - today.weekday()).isoformat()
    response = await owner.post(
        path + "/tasks",
        json={
            "title": "PRIVATE_TASK_SENTINEL",
            "goal_id": goal,
            "resource_id": resource["id"],
            "scheduled_on": monday,
        },
    )
    assert response.status_code == 201, response.text
    idea = (
        await owner.post(
            scope + "/research/ideas",
            json={
                "title": "PRIVATE_IDEA_SENTINEL",
                "body": "IDEA_BODY_MUST_NEVER_LEAVE",
            },
        )
    ).json()
    response = await owner.post(
        scope + "/research/knowledge/edges",
        json={
            "from_type": "idea",
            "from_id": idea["id"],
            "to_type": "resource",
            "to_id": resource["id"],
            "relation": "inspired_by",
            "reason": "PRIVATE_EDGE_SENTINEL",
        },
    )
    assert response.status_code == 201, response.text
    review = (await owner.post(path + "/reviews", json={"week_start": monday})).json()
    assert review["stats"]["links_confirmed"] == 0
    ai = f"/api/v1/workspaces/{workspace}/ai"
    provider_id = uuid4()
    response = await owner.post(
        ai + "/providers",
        json={
            "id": str(provider_id),
            "name": "Synthetic weekly AI",
            "base_url": "https://provider.example.com/v1",
            "provider_type": "openai_compatible",
            "credential": uuid4().hex,
            "enabled": True,
            "timeout_seconds": 30,
            "max_retries": 0,
        },
    )
    assert response.status_code == 201, response.text
    response = await owner.post(
        ai + "/models",
        json={
            "id": str(uuid4()),
            "provider_id": str(provider_id),
            "provider_model_id": "synthetic-model",
            "enabled": True,
            "supports_stream": False,
            "pricing_currency": "USD",
            "display_name": "Synthetic",
            "supports_json": True,
            "context_window": 32000,
            "input_cost_per_million_minor": 1,
            "output_cost_per_million_minor": 1,
        },
    )
    assert response.status_code == 201, response.text
    model_id = response.json()["id"]
    async with session_factory() as db:
        provider = await db.get(AIProvider, provider_id)
        provider.last_health_status = "healthy"
        await db.commit()
    response = await owner.post(
        f"/api/v1/workspaces/{workspace}/research/ai/presets",
        json={"economical_model_ids": [model_id], "quality_model_ids": [model_id]},
    )
    assert response.status_code == 201, response.text
    outgoing = []

    async def resolve(_host, _port):
        return ["93.184.216.34"]

    def provider_mock(request):
        content = request.content.decode()
        assert all(
            sentinel not in content
            for sentinel in (
                "PRIVATE_",
                "IDEA_BODY_MUST_NEVER_LEAVE",
                idea["id"],
                resource["id"],
                review["id"],
            )
        )
        body = json.loads(content)
        data = json.loads(body["messages"][1]["content"])["data"]
        assert set(data) == {"statistics"}
        statistics = json.loads(data["statistics"])
        assert statistics == review["stats"] and all(
            type(value) is int for value in statistics.values()
        )
        outgoing.append(body)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"comment": "One planned item remains. Choose its next step."}
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 40, "completion_tokens": 30},
            },
        )

    execution = AIExecutionService(
        get_settings(),
        adapter_factory=lambda: OpenAICompatibleGenerationAdapter(
            resolver=resolve, transport_factory=lambda: httpx.MockTransport(provider_mock)
        ),
    )

    def generation():
        return {
            "id": str(uuid4()),
            "idempotency_key": str(uuid4()),
            "task_type": "weekly_comment",
            "target": {
                "entity_type": "weekly_review",
                "id": review["id"],
                "version": review["version"],
            },
            "expected_output_fields": ["comment"],
            "requested_output_tokens": 500,
            "send_confirmed": True,
        }

    async def queue():
        response = await owner.post(scope + "/research/ai/runs", json=generation())
        assert response.status_code == 202, response.text
        run_id = UUID(response.json()["id"])
        async with session_factory() as db:
            run = await db.get(AIRun, run_id)
            run.status = "running"
            await db.commit()
        return run_id

    for kind in ("resource", "research_idea"):
        bad = {
            **generation(),
            "context_entities": [{"entity_type": kind, "id": resource["id"], "version": 1}],
        }
        assert (await owner.post(scope + "/research/ai/runs", json=bad)).status_code in (403, 422)
    generic = {
        "id": str(uuid4()),
        "idempotency_key": str(uuid4()),
        "task_type": "weekly_comment",
        "target_type": "weekly_review",
        "target_id": review["id"],
        "target_version": 1,
        "input_fields": {"statistics": "PRIVATE_SENTINEL"},
        "expected_output_fields": ["comment"],
        "requested_output_tokens": 500,
        "send_confirmed": True,
    }
    assert (await owner.post(ai + "/runs", json=generic)).json()[
        "code"
    ] == "AI_CONTEXT_TYPE_BLOCKED"
    run_id = await queue()
    await execution.execute_run(run_id)
    result = (await owner.get(f"/api/v1/workspaces/{workspace}/research/ai/runs/{run_id}")).json()
    assert result["run"]["status"] == "succeeded", result
    assert len(outgoing) == 1
    assert (await owner.get(path, params={"week_start": monday})).json()["review"][
        "ai_comment"
    ] is None
    accept = {"expected_version": 1, "draft_id": result["draft"]["id"], "expected_draft_version": 1}
    assert (
        await peer.post(path + f"/reviews/{review['id']}/comment", json=accept)
    ).status_code == 404
    response = await owner.post(path + f"/reviews/{review['id']}/comment", json=accept)
    assert response.status_code == 200, response.text
    review = response.json()
    assert review["ai_comment"] == result["draft"]["structured_output"]["comment"]
    assert (
        await owner.post(path + f"/reviews/{review['id']}/comment", json=accept)
    ).status_code == 409
    stale = await queue()
    review = (
        await owner.post(
            path + f"/reviews/{review['id']}/refresh", json={"expected_version": review["version"]}
        )
    ).json()
    assert review["ai_comment"] is None
    await execution.execute_run(stale)
    assert len(outgoing) == 1
    async with session_factory() as db:
        run = await db.get(AIRun, stale)
        assert run.status == "failed" and run.error_code == "RESOURCE_VERSION_CONFLICT"
    revoked = await queue()
    async with session_factory() as db:
        member = await db.scalar(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == UUID(workspace),
                WorkspaceMembership.user_id == users[0],
            )
        )
        member.status = "suspended"
        await db.commit()
    await execution.execute_run(revoked)
    assert len(outgoing) == 1
    async with session_factory() as db:
        run = await db.get(AIRun, revoked)
        assert run.status == "failed" and run.error_code == "RESOURCE_NOT_FOUND"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reading_tasks_are_invisible_to_legacy_sync_export_and_shared_mutations(weekly_scope):
    owner, peer, scope, workspace, users, goal, _resource = weekly_scope
    private = await owner.post(
        scope + "/research/weekly/tasks",
        json={
            "title": "PRIVATE_TASK_SENTINEL",
            "goal_id": goal,
            "scheduled_on": "2026-09-28",
        },
    )
    assert private.status_code == 201, private.text
    task = private.json()
    legacy = await owner.post(
        scope + "/tasks",
        json={
            "id": str(uuid4()),
            "goal_id": goal,
            "title": "Shared legacy task",
        },
    )
    assert legacy.status_code == 201, legacy.text
    sync = f"/api/v1/workspaces/{workspace}/sync"
    for client in (owner, peer):
        for suffix, body in (
            (f"/tasks/{task['id']}/transition", {"expected_version": 1, "status": "done"}),
            (f"/tasks/{task['id']}/close", {"expected_task_version": 1}),
            ("/sessions", {"id": str(uuid4()), "task_id": task["id"]}),
            (
                "/evidence",
                {
                    "task_id": task["id"],
                    "evidence_id": str(uuid4()),
                    "verification_id": str(uuid4()),
                    "evidence_type": "text",
                    "summary": "Synthetic",
                },
            ),
            ("/notes", {"id": str(uuid4()), "task_id": task["id"], "title": "Synthetic"}),
            (
                "/resources",
                {
                    "id": str(uuid4()),
                    "task_id": task["id"],
                    "title": "Synthetic",
                    "resource_type": "link",
                    "source_url": "https://example.com/synthetic",
                },
            ),
        ):
            response = await client.post(scope + suffix, json=body)
            assert response.status_code == 404, (suffix, response.text)
        assert (await client.get(sync + f"/deletion-preview/task/{task['id']}")).status_code == 404
        response = await client.get(sync + f"/deletion-preview/learning_goal/{goal}")
        assert response.status_code == 409 and task["id"] not in response.text
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device = next(item["id"] for item in devices if item["current"])
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
        ids = {item["entity_id"] for item in boot["records"]}
        assert task["id"] not in ids and legacy.json()["id"] in ids
        for operation_type, version in (
            ("update", 0),
            ("update", 1),
            ("delete", 1),
            ("restore", 1),
        ):
            payload = (
                {"space_id": scope.split("/")[-1], "status": "in_progress", "blocked_reason": None}
                if operation_type == "update"
                else {}
            )
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
                            "entity_type": "task",
                            "entity_id": task["id"],
                            "operation_type": operation_type,
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
            assert (
                "PRIVATE_TASK_SENTINEL" not in response.text
                and "remote_snapshot" not in response.text
            )
        search = await client.post(
            f"/api/v1/workspaces/{workspace}/search", json={"query": "PRIVATE_TASK_SENTINEL"}
        )
        assert search.status_code == 200 and task["id"] not in search.text
    async with session_factory() as db:
        service = object.__new__(PortabilityService)
        for user in users:
            archive = await service._build_archive(
                db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
            )
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                data = json.loads(bundle.read("data.json"))
            rows = data["objects"]["tasks"]
            assert [item["id"] for item in rows] == [legacy.json()["id"]]
            assert "scheduled_on" not in rows[0] and "resource_id" not in rows[0]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weekly_rollover_quota_failure_rolls_back_every_next_task(weekly_scope):
    owner, _peer, scope, workspace, users, goal, _resource = weekly_scope
    week = date(2026, 11, 2)
    path = scope + "/research/weekly"
    tasks = []
    for title in ("First carry", "Second carry"):
        response = await owner.post(
            path + "/tasks",
            json={
                "title": title,
                "goal_id": goal,
                "scheduled_on": week.isoformat(),
            },
        )
        assert response.status_code == 201, response.text
        tasks.append(response.json())
    review = (await owner.post(path + "/reviews", json={"week_start": week.isoformat()})).json()
    async with session_factory() as db:
        db.add_all(
            [
                Task(
                    workspace_id=UUID(workspace),
                    space_id=UUID(scope.split("/")[-1]),
                    goal_id=UUID(goal),
                    title=f"Synthetic scheduled {index}",
                    research_owner_id=users[0],
                    reading_mode="skim",
                    scheduled_on=week + timedelta(days=7),
                    status="planned",
                    created_by=users[0],
                    updated_by=users[0],
                )
                for index in range(199)
            ]
        )
        await db.commit()
    body = {
        "expected_version": review["version"],
        "triage": [{"task_id": task["id"], "action": "carry"} for task in tasks],
    }
    response = await owner.post(path + f"/reviews/{review['id']}/close", json=body)
    assert response.status_code == 409 and response.json()["code"] == "WEEKLY_TASK_LIMIT"
    async with session_factory() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(Task)
                .where(
                    Task.research_owner_id == users[0],
                    Task.scheduled_on == week + timedelta(days=7),
                )
            )
            == 199
        )
    assert (await owner.get(path, params={"week_start": week.isoformat()})).json()["review"][
        "closed_at"
    ] is None
    body["triage"][1]["action"] = "drop"
    response = await owner.post(path + f"/reviews/{review['id']}/close", json=body)
    assert response.status_code == 200, response.text
    listing = await owner.get(path, params={"week_start": (week + timedelta(days=7)).isoformat()})
    assert len(listing.json()["tasks"]) == 200


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weekly_inbox_counts_owner_space_week_and_preserves_closed_snapshot(weekly_scope):
    owner, peer, scope, workspace, users, _goal, _resource = weekly_scope
    space = UUID(scope.rsplit("/", 1)[-1])
    spaces = (await owner.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"]
    other_space = next(UUID(item["id"]) for item in spaces if UUID(item["id"]) != space)
    start = datetime(2026, 9, 27, 16, tzinfo=UTC)  # Monday in Asia/Shanghai.
    end = start + timedelta(days=7)
    sentinel = "PRIVATE_AGENT_PAYLOAD_SENTINEL"

    async def add_item(user_id, space_id, created_at, *, discarded=False):
        async with session_factory() as db:
            token = AgentToken(
                id=uuid4(),
                user_id=user_id,
                workspace_id=UUID(workspace),
                space_id=space_id,
                name="Synthetic weekly token",
                token_digest=uuid4().hex * 2,
                scopes=["inbox:write"],
                created_at=start - timedelta(days=1),
                expires_at=end + timedelta(days=1),
                revoked_at=start + timedelta(hours=1) if discarded else None,
            )
            db.add(token)
            await db.flush()
            db.add(
                AgentInboxItem(
                    token_id=token.id,
                    user_id=user_id,
                    workspace_id=UUID(workspace),
                    space_id=space_id,
                    submission_key=str(uuid4()),
                    kind="source",
                    payload={"kind": "source", "title": sentinel},
                    payload_digest="a" * 64,
                    created_at=created_at,
                    status="discarded" if discarded else "pending",
                    decided_at=end if discarded else None,
                    decision_digest="b" * 64 if discarded else None,
                )
            )
            await db.commit()

    await add_item(users[0], space, start)
    await add_item(users[0], space, end - timedelta(microseconds=1), discarded=True)
    await add_item(users[0], space, start - timedelta(microseconds=1))
    await add_item(users[0], space, end)
    await add_item(users[1], space, start)
    await add_item(users[0], other_space, start)
    path = scope + "/research/weekly"
    payload = {"week_start": "2026-09-28", "timezone": "Asia/Shanghai"}
    response = await owner.post(path + "/reviews", json=payload)
    assert response.status_code == 200, response.text
    review = response.json()
    assert review["stats"]["inbox_items"] == 2
    assert all(type(value) is int for value in review["stats"].values())
    assert sentinel not in response.text
    peer_review = await peer.post(path + "/reviews", json=payload)
    assert peer_review.status_code == 200, peer_review.text
    assert peer_review.json()["stats"]["inbox_items"] == 1
    assert (
        await peer.post(path + f"/reviews/{review['id']}/refresh", json={"expected_version": 1})
    ).status_code == 404

    await add_item(users[0], space, start + timedelta(hours=1))
    unchanged = await owner.get(path, params={"week_start": payload["week_start"]})
    assert unchanged.json()["review"]["stats"]["inbox_items"] == 2
    refreshed = await owner.post(
        path + f"/reviews/{review['id']}/refresh", json={"expected_version": 1}
    )
    assert refreshed.status_code == 200, refreshed.text
    review = refreshed.json()
    assert review["stats"]["inbox_items"] == 3
    closed = await owner.post(
        path + f"/reviews/{review['id']}/close",
        json={"expected_version": review["version"], "triage": []},
    )
    assert closed.status_code == 200, closed.text
    await add_item(users[0], space, start + timedelta(hours=2))
    historical = await owner.get(path, params={"week_start": payload["week_start"]})
    assert historical.json()["review"]["stats"]["inbox_items"] == 3
    assert sentinel not in historical.text
