from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.execution.evidence_models import VerificationRecord
from logion_api.execution.models import Task
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_human_evidence_revision_pass_and_close_flow() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.86", 48006)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        assert (
            await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"evidence-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "Evidence browser",
                },
            )
        ).status_code == 201
        csrf = client.cookies["logion_csrf"]
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )
        goal_id, phase_id = uuid4(), uuid4()
        goal = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json={
                "goal_id": str(goal_id),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Evidence goal",
                "description": "",
                "desired_outcome": "Verified output",
                "weekly_minutes": 60,
                "target_date": None,
                "phases": [
                    {
                        "id": str(phase_id),
                        "title": "Phase",
                        "description": "",
                        "position": 0,
                        "estimated_minutes": 60,
                        "acceptance_criteria": ["Human review passes"],
                    }
                ],
            },
        )
        assert goal.status_code == 201
        task_id = uuid4()
        task = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers={"X-CSRF-Token": csrf},
            json={
                "id": str(task_id),
                "goal_id": str(goal_id),
                "phase_id": str(phase_id),
                "title": "Produce output",
                "description": "",
                "planned_at": "2026-07-22T09:00:00Z",
            },
        )
        assert task.status_code == 201
        started = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/transition",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "status": "in_progress"},
        )
        assert started.status_code == 200

        async def submit(summary: str):
            evidence_id, verification_id = uuid4(), uuid4()
            response = await client.post(
                f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/evidence",
                headers={"X-CSRF-Token": csrf},
                json={
                    "evidence_id": str(evidence_id),
                    "verification_id": str(verification_id),
                    "task_id": str(task_id),
                    "evidence_type": "text",
                    "summary": summary,
                },
            )
            assert response.status_code == 201, response.text
            return evidence_id, verification_id, response.json()

        missing_csrf = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/evidence",
            json={
                "evidence_id": str(uuid4()),
                "verification_id": str(uuid4()),
                "task_id": str(task_id),
                "evidence_type": "text",
                "summary": "missing csrf",
            },
        )
        assert missing_csrf.status_code == 403
        _, first_verification, first = await submit("private draft evidence")
        assert first["task_status"] == "submitted"
        revision = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/verifications/{first_verification}/decision",
            headers={"X-CSRF-Token": csrf},
            json={
                "expected_version": 1,
                "verdict": "needs_revision",
                "reviewer_notes": "private reviewer note",
            },
        )
        assert revision.status_code == 200, revision.text
        assert revision.json()["task_status"] == "in_progress"
        stale = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/verifications/{first_verification}/decision",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "verdict": "passed", "reviewer_notes": ""},
        )
        assert stale.status_code == 409

        _, second_verification, second = await submit("revised private evidence")
        passed = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/verifications/{second_verification}/decision",
            headers={"X-CSRF-Token": csrf},
            json={"expected_version": 1, "verdict": "passed", "reviewer_notes": "accepted"},
        )
        assert passed.status_code == 200, passed.text
        assert passed.json()["task_status"] == "verified"
        closed = await client.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks/{task_id}/close",
            headers={"X-CSRF-Token": csrf},
            json={"expected_task_version": passed.json()["task_version"]},
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["task_status"] == "done"

    async with session_factory() as db:
        stored_task = await db.get(Task, task_id)
        assert stored_task is not None and stored_task.status == "done"
        records = list(
            await db.scalars(
                select(VerificationRecord).where(VerificationRecord.task_id == task_id)
            )
        )
        assert {record.verdict for record in records} == {"needs_revision", "passed"}
        audits = list(
            await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
        )
        serialized = " ".join(str(item.event_metadata) for item in audits)
        assert "private draft evidence" not in serialized
        assert "private reviewer note" not in serialized
