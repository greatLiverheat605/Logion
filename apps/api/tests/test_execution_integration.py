from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.execution.models import SessionEvent, StudySession, Task
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_task_session_lifecycle_and_tenant_boundaries() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.80", 48000)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.81", 48001)),
            base_url=origin,
            headers={"Origin": origin},
        ) as other,
    ):
        registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"execution-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Execution browser",
            },
        )
        assert registered.status_code == 201, registered.text
        csrf = owner.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]
        workspace_id = UUID(workspace["id"])
        spaces = (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"]
        space_id = UUID(spaces[0]["id"])

        goal_id = uuid4()
        phase_id = uuid4()
        planning_payload = {
            "goal_id": str(goal_id),
            "plan_id": str(uuid4()),
            "plan_version_id": str(uuid4()),
            "title": "Distributed systems study",
            "description": "User-provided learning context",
            "desired_outcome": "Produce a review artifact",
            "weekly_minutes": 420,
            "target_date": "2026-12-01",
            "phases": [
                {
                    "id": str(phase_id),
                    "title": "Foundations",
                    "description": "Read and practice",
                    "position": 0,
                    "estimated_minutes": 1200,
                    "acceptance_criteria": ["Submit a review"],
                }
            ],
        }
        planned = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json=planning_payload,
        )
        assert planned.status_code == 201, planned.text

        task_id = uuid4()
        task_payload = {
            "id": str(task_id),
            "goal_id": str(goal_id),
            "phase_id": str(phase_id),
            "title": "Read the first chapter",
            "description": "Record uncertain points in a note.",
            "priority": 2,
            "estimated_minutes": 90,
        }
        missing_csrf = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks", json=task_payload
        )
        assert missing_csrf.status_code == 403
        created = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers={"X-CSRF-Token": csrf},
            json=task_payload,
        )
        assert created.status_code == 201, created.text
        assert created.json()["status"] == "backlog"

        blocked_without_reason = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/transition",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "status": "blocked"},
        )
        assert blocked_without_reason.status_code == 422
        cannot_self_verify = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/transition",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "status": "verified"},
        )
        assert cannot_self_verify.status_code == 409

        task_version = 1
        for desired_status in ("planned", "in_progress"):
            transitioned = await owner.post(
                f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/transition",
                headers={"X-CSRF-Token": csrf},
                json={"expected_version": task_version, "status": desired_status},
            )
            assert transitioned.status_code == 200, transitioned.text
            task_version = transitioned.json()["version"]
            assert transitioned.json()["status"] == desired_status

        stale_transition = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/transition",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "status": "submitted"},
        )
        assert stale_transition.status_code == 409

        session_id = uuid4()
        started = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/sessions",
            headers={"X-CSRF-Token": csrf},
            json={"id": str(session_id), "task_id": str(task_id)},
        )
        assert started.status_code == 201, started.text
        assert started.json()["status"] == "active"

        second_task_id = uuid4()
        second_task = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers={"X-CSRF-Token": csrf},
            json={
                **task_payload,
                "id": str(second_task_id),
                "planned_at": "2026-07-22T09:00:00Z",
            },
        )
        assert second_task.status_code == 201, second_task.text
        second_active = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/sessions",
            headers={"X-CSRF-Token": csrf},
            json={"id": str(uuid4()), "task_id": str(second_task_id)},
        )
        assert second_active.status_code == 409

        reflection = "The consistency model is clearer; revisit failure detection."
        finished = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/sessions/{session_id}/finish",
            headers={"X-CSRF-Token": csrf},
            json={
                "expected_version": 1,
                "outcome": "completed",
                "manual_minutes": 75,
                "reflection": reflection,
            },
        )
        assert finished.status_code == 200, finished.text
        assert finished.json()["status"] == "completed"
        stale_finish = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/sessions/{session_id}/finish",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "outcome": "abandoned"},
        )
        assert stale_finish.status_code == 409

        other_registered = await other.post(
            "/api/v1/auth/register",
            json={
                "email": f"execution-other-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Other browser",
            },
        )
        assert other_registered.status_code == 201
        cross_tenant = await other.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers={"X-CSRF-Token": other.cookies["logion_csrf"]},
            json={**task_payload, "id": str(uuid4())},
        )
        assert cross_tenant.status_code == 404

    async with session_factory() as db:
        task = await db.get(Task, task_id)
        session = await db.get(StudySession, session_id)
        assert task is not None and task.status == "in_progress"
        assert session is not None and session.reflection == reflection
        events = list(
            await db.scalars(
                select(SessionEvent)
                .where(SessionEvent.session_id == session_id)
                .order_by(SessionEvent.occurred_at)
            )
        )
        assert [event.event_type for event in events] == ["started", "completed"]
        assert all(reflection not in str(event.event_metadata) for event in events)
        audits = list(
            await db.scalars(
                select(AuditEvent).where(
                    AuditEvent.target_id.in_([task_id, session_id]),
                    AuditEvent.event_type.like("execution.%"),
                )
            )
        )
        assert {audit.event_type for audit in audits} >= {
            "execution.task_created",
            "execution.task_transitioned",
            "execution.session_started",
            "execution.session_finished",
        }
        assert all(reflection not in str(audit.event_metadata) for audit in audits)
