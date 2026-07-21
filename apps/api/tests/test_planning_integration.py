from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from sqlalchemy import func, select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_goal_plan_creation_publication_and_tenant_boundaries() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.70", 47000)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.71", 47001)),
            base_url=origin,
            headers={"Origin": origin},
        ) as other,
    ):
        registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"planning-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Planning browser",
            },
        )
        assert registered.status_code == 201, registered.text
        csrf = owner.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]
        workspace_id = UUID(workspace["id"])
        space = (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]
        space_id = UUID(space["id"])
        phase_id = uuid4()
        payload = {
            "goal_id": str(uuid4()),
            "plan_id": str(uuid4()),
            "plan_version_id": str(uuid4()),
            "title": "数据库系统复习",
            "description": "用户自定义内容",
            "desired_outcome": "完成一份可验收的复习总结",
            "weekly_minutes": 420,
            "target_date": "2026-12-01",
            "phases": [
                {
                    "id": str(phase_id),
                    "title": "基础阶段",
                    "description": "概念与练习",
                    "position": 0,
                    "estimated_minutes": 1200,
                    "acceptance_criteria": ["完成自测并达到 80%"],
                }
            ],
        }
        missing_csrf = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals", json=payload
        )
        assert missing_csrf.status_code == 403

        created = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json=payload,
        )
        assert created.status_code == 201, created.text
        assert created.json()["goal_status"] == "draft"
        assert created.json()["phases"][0]["id"] == str(phase_id)

        duplicate = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": csrf},
            json=payload,
        )
        assert duplicate.status_code == 409

        published = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals/{payload['goal_id']}/publish",
            headers={"X-CSRF-Token": csrf},
            json={
                "expected_goal_version": 1,
                "expected_plan_version": 1,
                "change_summary": "Initial publication",
            },
        )
        assert published.status_code == 200, published.text
        assert published.json()["goal_status"] == "active"
        assert published.json()["plan_version_status"] == "published"
        stale = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals/{payload['goal_id']}/publish",
            headers={"X-CSRF-Token": csrf},
            json={"expected_goal_version": 1, "expected_plan_version": 1},
        )
        assert stale.status_code == 409

        other_registered = await other.post(
            "/api/v1/auth/register",
            json={
                "email": f"planning-other-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Other browser",
            },
        )
        assert other_registered.status_code == 201
        cross_tenant = await other.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers={"X-CSRF-Token": other.cookies["logion_csrf"]},
            json={**payload, "goal_id": str(uuid4()), "plan_id": str(uuid4())},
        )
        assert cross_tenant.status_code == 404

    async with session_factory() as db:
        assert await db.get(LearningGoal, UUID(str(payload["goal_id"]))) is not None
        assert await db.get(LearningPlan, UUID(str(payload["plan_id"]))) is not None
        assert await db.get(PlanVersion, UUID(str(payload["plan_version_id"]))) is not None
        assert await db.get(PlanPhase, phase_id) is not None
        audit_count = await db.scalar(
            select(func.count(AuditEvent.id)).where(
                AuditEvent.event_type.in_(("planning.goal_created", "planning.plan_published"))
            )
        )
        assert int(audit_count or 0) == 2
