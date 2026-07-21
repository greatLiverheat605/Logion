from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.execution.models import StudySession, Task
from logion_api.main import app
from logion_api.sync.push import canonical_hash


@pytest.mark.integration
@pytest.mark.asyncio
async def test_task_and_session_sync_replay_conflict_and_bootstrap() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.82", 48002)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"execution-sync-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Offline execution device",
            },
        )
        assert registered.status_code == 201, registered.text
        csrf = client.cookies["logion_csrf"]
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        spaces = (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"]
        space_id = UUID(spaces[0]["id"])
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device_id = UUID(next(device["id"] for device in devices if device["current"]))

        bootstrap_request = {
            "message_type": "bootstrap_request",
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(device_id),
            "known_sync_epoch": None,
            "snapshot_id": None,
            "chunk_index": None,
        }
        initial = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_request
        )
        assert initial.status_code == 200, initial.text
        sync_epoch = initial.json()["sync_epoch"]

        goal_id = uuid4()
        phase_id = uuid4()
        goal = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json={
                "goal_id": str(goal_id),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Offline execution goal",
                "description": "Private context",
                "desired_outcome": "Submit an artifact",
                "weekly_minutes": 300,
                "target_date": None,
                "phases": [
                    {
                        "id": str(phase_id),
                        "title": "First phase",
                        "description": "",
                        "position": 0,
                        "estimated_minutes": 600,
                        "acceptance_criteria": ["Submit evidence"],
                    }
                ],
            },
        )
        assert goal.status_code == 201, goal.text

        now = datetime.now(UTC).isoformat()

        def operation(
            *,
            operation_id: UUID,
            entity_type: str,
            entity_id: UUID,
            operation_type: str,
            base_version: int,
            payload: dict[str, object],
            dependencies: list[UUID] | None = None,
        ) -> dict[str, object]:
            return {
                "operation_id": str(operation_id),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "operation_type": operation_type,
                "base_version": base_version,
                "client_occurred_at": now,
                "payload": payload,
                "payload_hash": canonical_hash(payload),
                "dependencies": [str(item) for item in dependencies or []],
            }

        async def push(items: list[dict[str, object]]):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": csrf},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_id),
                    "sync_epoch": sync_epoch,
                    "operations": items,
                },
            )

        task_id = uuid4()
        create_task_id = uuid4()
        create_task = operation(
            operation_id=create_task_id,
            entity_type="task",
            entity_id=task_id,
            operation_type="create",
            base_version=0,
            payload={
                "space_id": str(space_id),
                "goal_id": str(goal_id),
                "phase_id": str(phase_id),
                "title": "Read and summarize",
                "description": "Sensitive task description",
                "priority": 2,
                "estimated_minutes": 60,
                "planned_at": "2026-07-22T09:00:00Z",
                "due_at": None,
                "status": "planned",
                "blocked_reason": None,
            },
        )
        created = await push([create_task])
        assert created.status_code == 200, created.text
        assert created.json()["results"][0]["status"] == "applied"

        transition_id = uuid4()
        transition = operation(
            operation_id=transition_id,
            entity_type="task",
            entity_id=task_id,
            operation_type="update",
            base_version=0,
            payload={
                "space_id": str(space_id),
                "status": "in_progress",
                "blocked_reason": None,
            },
            dependencies=[create_task_id],
        )
        transitioned = await push([transition])
        assert transitioned.status_code == 200, transitioned.text
        assert transitioned.json()["results"][0]["server_version"] == 2

        stale = operation(
            operation_id=uuid4(),
            entity_type="task",
            entity_id=task_id,
            operation_type="update",
            base_version=1,
            payload={
                "space_id": str(space_id),
                "status": "in_progress",
                "blocked_reason": None,
            },
        )
        conflicted = await push([stale])
        assert conflicted.status_code == 200, conflicted.text
        conflict = conflicted.json()["results"][0]
        assert conflict["status"] == "conflict"
        assert conflict["conflict"]["remote_version"] == 2
        assert conflict["conflict"]["remote_payload"]["description"] == "Sensitive task description"

        session_id = uuid4()
        start_id = uuid4()
        start = operation(
            operation_id=start_id,
            entity_type="study_session",
            entity_id=session_id,
            operation_type="create",
            base_version=0,
            payload={
                "space_id": str(space_id),
                "task_id": str(task_id),
                "status": "active",
                "started_at": now,
                "ended_at": None,
                "manual_minutes": None,
                "reflection": "",
                "outcome": None,
            },
            dependencies=[transition_id],
        )
        started = await push([start])
        assert started.status_code == 200, started.text
        assert started.json()["results"][0]["status"] == "applied"
        replay = await push([start])
        assert replay.status_code == 200
        assert replay.json()["results"][0]["status"] == "duplicate"

        finish = operation(
            operation_id=uuid4(),
            entity_type="study_session",
            entity_id=session_id,
            operation_type="update",
            base_version=0,
            payload={
                "space_id": str(space_id),
                "outcome": "completed",
                "manual_minutes": 55,
                "reflection": "Private session reflection",
                "task_id": str(task_id),
                "status": "completed",
                "started_at": now,
                "ended_at": now,
            },
            dependencies=[start_id],
        )
        finished = await push([finish])
        assert finished.status_code == 200, finished.text
        assert finished.json()["results"][0]["server_version"] == 2

        snapshot = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_request
        )
        assert snapshot.status_code == 200, snapshot.text
        records = {
            (record["entity_type"], record["entity_id"]): record
            for record in snapshot.json()["records"]
        }
        assert records[("task", str(task_id))]["payload"]["status"] == "in_progress"
        assert records[("study_session", str(session_id))]["payload"]["reflection"] == (
            "Private session reflection"
        )
        assert snapshot.json()["cursor"] == 4

    async with session_factory() as db:
        task = await db.get(Task, task_id)
        session = await db.get(StudySession, session_id)
        assert task is not None and task.status == "in_progress"
        assert session is not None and session.status == "completed"
        assert session.updated_by == session.created_by
        assert session.deleted_at is None
