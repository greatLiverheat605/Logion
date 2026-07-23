from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app
from logion_api.sync.push import canonical_hash


@pytest.mark.integration
@pytest.mark.asyncio
async def test_phase3_two_device_offline_learning_loop_and_tenant_boundary() -> None:
    origin = "http://test"
    email = f"phase3-loop-{uuid4()}@example.com"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.90", 48100)),
            base_url=origin,
            headers={"Origin": origin},
        ) as device_a,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.91", 48101)),
            base_url=origin,
            headers={"Origin": origin},
        ) as device_b,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.92", 48102)),
            base_url=origin,
            headers={"Origin": origin},
        ) as outsider,
    ):
        registered = await device_a.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Offline device A",
            },
        )
        assert registered.status_code == 201, registered.text
        logged_in = await device_b.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Offline device B",
            },
        )
        assert logged_in.status_code == 200, logged_in.text
        outsider_registered = await outsider.post(
            "/api/v1/auth/register",
            json={
                "email": f"phase3-outsider-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Outsider device",
            },
        )
        assert outsider_registered.status_code == 201

        workspace_id = UUID(
            (await device_a.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        space_id = UUID(
            (await device_a.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )

        async def current_device(client: AsyncClient) -> UUID:
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(item["id"] for item in devices if item["current"]))

        device_a_id = await current_device(device_a)
        device_b_id = await current_device(device_b)
        outsider_device_id = await current_device(outsider)

        def bootstrap_body(device_id: UUID) -> dict[str, object]:
            return {
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            }

        first_a = await device_a.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(device_a_id),
        )
        first_b = await device_b.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(device_b_id),
        )
        assert first_a.status_code == first_b.status_code == 200
        epoch = first_a.json()["sync_epoch"]
        assert first_b.json()["sync_epoch"] == epoch
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
                "device_id": str(device_a_id),
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "operation_type": kind,
                "base_version": base,
                "client_occurred_at": now,
                "payload": payload,
                "payload_hash": canonical_hash(payload),
                "dependencies": [str(item) for item in dependencies or []],
            }

        async def push(item: dict[str, object]) -> dict[str, object]:
            response = await device_a.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": device_a.cookies["logion_csrf"]},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_a_id),
                    "sync_epoch": epoch,
                    "operations": [item],
                },
            )
            assert response.status_code == 200, response.text
            result = cast(dict[str, object], response.json()["results"][0])
            assert result["status"] in {"applied", "duplicate"}, result
            return result

        goal_id, plan_id, plan_version_id, phase_id = uuid4(), uuid4(), uuid4(), uuid4()
        goal_op = uuid4()
        await push(
            operation(
                "learning_goal",
                goal_id,
                goal_op,
                "create",
                0,
                {
                    "space_id": str(space_id),
                    "plan_id": str(plan_id),
                    "plan_version_id": str(plan_version_id),
                    "title": "User supplied research goal",
                    "description": "Private goal context",
                    "desired_outcome": "A human-reviewed artifact",
                    "weekly_minutes": 360,
                    "target_date": None,
                    "phases": [
                        {
                            "id": str(phase_id),
                            "title": "Evidence phase",
                            "description": "",
                            "position": 0,
                            "estimated_minutes": 360,
                            "acceptance_criteria": ["Human reviewer passes the note"],
                        }
                    ],
                },
            )
        )

        task_id, task_create_op = uuid4(), uuid4()
        task_payload = {
            "space_id": str(space_id),
            "goal_id": str(goal_id),
            "phase_id": str(phase_id),
            "title": "Produce reviewable notes",
            "description": "Private task context",
            "priority": 2,
            "estimated_minutes": 60,
            "planned_at": "2026-07-22T09:00:00Z",
            "due_at": None,
            "status": "planned",
            "blocked_reason": None,
        }
        await push(operation("task", task_id, task_create_op, "create", 0, task_payload, [goal_op]))
        task_start_op = uuid4()
        await push(
            operation(
                "task",
                task_id,
                task_start_op,
                "update",
                0,
                {"space_id": str(space_id), "status": "in_progress", "blocked_reason": None},
                [task_create_op],
            )
        )

        session_id, session_start_op = uuid4(), uuid4()
        session_payload: dict[str, object] = {
            "space_id": str(space_id),
            "task_id": str(task_id),
            "status": "active",
            "started_at": now,
            "ended_at": None,
            "manual_minutes": None,
            "reflection": "",
            "outcome": None,
        }
        await push(
            operation(
                "study_session",
                session_id,
                session_start_op,
                "create",
                0,
                session_payload,
                [task_start_op],
            )
        )
        await push(
            operation(
                "study_session",
                session_id,
                uuid4(),
                "update",
                0,
                {
                    **session_payload,
                    "status": "completed",
                    "ended_at": now,
                    "manual_minutes": 55,
                    "reflection": "Private learning reflection",
                    "outcome": "completed",
                },
                [session_start_op],
            )
        )

        note_id, note_op = uuid4(), uuid4()
        await push(
            operation(
                "note",
                note_id,
                note_op,
                "create",
                0,
                {
                    "space_id": str(space_id),
                    "task_id": str(task_id),
                    "title": "Research note",
                    "markdown_body": "# Private result\n\nEvidence body.",
                },
            )
        )
        resource_id = uuid4()
        await push(
            operation(
                "resource",
                resource_id,
                uuid4(),
                "create",
                0,
                {
                    "space_id": str(space_id),
                    "task_id": str(task_id),
                    "resource_type": "link",
                    "title": "Reference",
                    "source_url": "https://example.com/reference",
                    "pdf_filename": None,
                    "page_count": None,
                    "sha256": None,
                    "page_index": [],
                },
            )
        )

        task_submit_op = uuid4()
        await push(
            operation(
                "task",
                task_id,
                task_submit_op,
                "update",
                2,
                {"space_id": str(space_id), "status": "submitted", "blocked_reason": None},
            )
        )
        evidence_id, verification_id, evidence_op = uuid4(), uuid4(), uuid4()
        evidence_operation = operation(
            "evidence",
            evidence_id,
            evidence_op,
            "create",
            0,
            {
                "space_id": str(space_id),
                "verification_id": str(verification_id),
                "task_id": str(task_id),
                "evidence_type": "note",
                "note_id": str(note_id),
                "resource_id": None,
                "summary": "",
                "external_url": None,
            },
            [task_submit_op, note_op],
        )
        evidence_result = await push(evidence_operation)
        replay = await push(evidence_operation)
        assert replay["status"] == "duplicate"
        assert replay["sequence"] == evidence_result["sequence"]

        decision_op = uuid4()
        await push(
            operation(
                "verification",
                verification_id,
                decision_op,
                "update",
                1,
                {
                    "space_id": str(space_id),
                    "action": "decide",
                    "verdict": "passed",
                    "reviewer_notes": "Explicit human approval",
                },
                [evidence_op],
            )
        )
        await push(
            operation(
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
                [decision_op],
            )
        )

        pulled = await device_b.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull",
            json={
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_b_id),
                "sync_epoch": epoch,
                "cursor": 0,
                "limit": 100,
            },
        )
        assert pulled.status_code == 200, pulled.text
        changes = pulled.json()["changes"]
        assert [item["sequence"] for item in changes] == list(range(1, 16))
        latest = {(item["entity_type"], item["entity_id"]): item for item in changes}
        assert latest[("task", str(task_id))]["payload"]["status"] == "done"
        assert latest[("study_session", str(session_id))]["payload"]["reflection"] == (
            "Private learning reflection"
        )
        assert latest[("note", str(note_id))]["payload"]["markdown_body"].startswith("# Private")
        assert latest[("resource", str(resource_id))]["payload"]["source_url"].startswith(
            "https://"
        )
        assert latest[("evidence", str(evidence_id))]["payload"]["note_id"] == str(note_id)
        assert latest[("verification", str(verification_id))]["payload"]["verdict"] == "passed"

        snapshot = await device_b.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(device_b_id),
        )
        records = {
            (item["entity_type"], item["entity_id"]): item for item in snapshot.json()["records"]
        }
        assert records[("task", str(task_id))]["payload"]["status"] == "done"
        assert records[("verification", str(verification_id))]["payload"]["verdict"] == "passed"

        forbidden = await outsider.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json={**bootstrap_body(outsider_device_id), "device_id": str(outsider_device_id)},
        )
        assert forbidden.status_code in {403, 404}
