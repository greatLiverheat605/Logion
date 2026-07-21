from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app
from logion_api.sync.push import canonical_hash


@pytest.mark.integration
@pytest.mark.asyncio
async def test_offline_evidence_decision_close_replay_and_bootstrap() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.87", 48007)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"evidence-sync-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Offline verification device",
            },
        )
        assert registered.status_code == 201, registered.text
        csrf = client.cookies["logion_csrf"]
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )
        device_id = UUID(
            next(
                item["id"]
                for item in (await client.get("/api/v1/auth/devices")).json()["devices"]
                if item["current"]
            )
        )
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
        epoch = initial.json()["sync_epoch"]
        goal_id, phase_id = uuid4(), uuid4()
        goal = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json={
                "goal_id": str(goal_id),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Offline evidence goal",
                "description": "",
                "desired_outcome": "Human verified result",
                "weekly_minutes": 60,
                "target_date": None,
                "phases": [
                    {
                        "id": str(phase_id),
                        "title": "Evidence phase",
                        "description": "",
                        "position": 0,
                        "estimated_minutes": 60,
                        "acceptance_criteria": ["Reviewer passes evidence"],
                    }
                ],
            },
        )
        assert goal.status_code == 201, goal.text
        now = datetime.now(UTC).isoformat()

        def operation(
            entity_type: str,
            entity_id: UUID,
            operation_id: UUID,
            kind: str,
            base: int,
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
                "operation_type": kind,
                "base_version": base,
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
                    "sync_epoch": epoch,
                    "operations": items,
                },
            )

        task_id, create_id, start_id, submit_id = uuid4(), uuid4(), uuid4(), uuid4()
        task_payload = {
            "space_id": str(space_id),
            "goal_id": str(goal_id),
            "phase_id": str(phase_id),
            "title": "Submit research note",
            "description": "Sensitive description",
            "priority": 1,
            "estimated_minutes": 45,
            "planned_at": "2026-07-22T09:00:00Z",
            "due_at": None,
            "status": "planned",
            "blocked_reason": None,
        }
        create = operation("task", task_id, create_id, "create", 0, task_payload)
        start = operation(
            "task",
            task_id,
            start_id,
            "update",
            0,
            {"space_id": str(space_id), "status": "in_progress", "blocked_reason": None},
            [create_id],
        )
        submit = operation(
            "task",
            task_id,
            submit_id,
            "update",
            0,
            {"space_id": str(space_id), "status": "submitted", "blocked_reason": None},
            [start_id],
        )
        prepared = await push([create, start, submit])
        assert prepared.status_code == 200, prepared.text
        assert [item["status"] for item in prepared.json()["results"]] == [
            "applied",
            "applied",
            "applied",
        ]

        evidence_id, verification_id, evidence_op_id = uuid4(), uuid4(), uuid4()
        evidence = operation(
            "evidence",
            evidence_id,
            evidence_op_id,
            "create",
            0,
            {
                "space_id": str(space_id),
                "verification_id": str(verification_id),
                "task_id": str(task_id),
                "evidence_type": "text",
                "note_id": None,
                "resource_id": None,
                "summary": "Private offline evidence",
                "external_url": None,
            },
            [submit_id],
        )
        submitted = await push([evidence])
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["results"][0]["status"] == "applied"
        replay = await push([evidence])
        assert replay.json()["results"][0]["status"] == "duplicate"

        decision_id = uuid4()
        decision = operation(
            "verification",
            verification_id,
            decision_id,
            "update",
            1,
            {
                "space_id": str(space_id),
                "action": "decide",
                "verdict": "passed",
                "reviewer_notes": "Private reviewer decision",
            },
            [evidence_op_id],
        )
        decided = await push([decision])
        assert decided.status_code == 200, decided.text
        assert decided.json()["results"][0]["server_version"] == 2

        close = operation(
            "verification",
            verification_id,
            uuid4(),
            "update",
            2,
            {
                "space_id": str(space_id),
                "action": "close_task",
                "task_id": str(task_id),
                "expected_task_version": 4,
            },
            [decision_id],
        )
        closed = await push([close])
        assert closed.status_code == 200, closed.text
        assert closed.json()["results"][0]["status"] == "applied"

        snapshot = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_request
        )
        records = {
            (item["entity_type"], item["entity_id"]): item
            for item in snapshot.json()["records"]
        }
        assert records[("task", str(task_id))]["payload"]["status"] == "done"
        assert records[("evidence", str(evidence_id))]["payload"]["summary"] == (
            "Private offline evidence"
        )
        assert records[("verification", str(verification_id))]["payload"]["verdict"] == "passed"
        assert snapshot.json()["cursor"] == 9

        stale = await push(
            [
                operation(
                    "verification",
                    verification_id,
                    uuid4(),
                    "update",
                    1,
                    {
                        "space_id": str(space_id),
                        "action": "close_task",
                        "task_id": str(task_id),
                        "expected_task_version": 4,
                    },
                )
            ]
        )
        assert stale.json()["results"][0]["status"] == "conflict"
