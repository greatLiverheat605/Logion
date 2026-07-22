from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.memory.models import MasteryRecord, ReviewSchedule, TopicDependency
from logion_api.memory.service import MemoryService
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_topic_graph_mastery_separation_review_schedule_and_permissions() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.93", 48200)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.94", 48201)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        owner_registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"memory-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Memory owner",
            },
        )
        assert owner_registered.status_code == 201, owner_registered.text
        owner_id = UUID(owner_registered.json()["user"]["id"])
        owner_csrf = owner.cookies["logion_csrf"]
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        private_space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner_csrf},
            json={"name": "Configurable cohort", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        shared_space_id = UUID(shared.json()["id"])

        viewer_registered = await viewer.post(
            "/api/v1/auth/register",
            json={
                "email": f"memory-viewer-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Memory viewer",
            },
        )
        assert viewer_registered.status_code == 201
        viewer_id = UUID(viewer_registered.json()["user"]["id"])
        viewer_csrf = viewer.cookies["logion_csrf"]

        outsider = await viewer.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{shared_space_id}/topics"
        )
        assert outsider.status_code == 404
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=viewer_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        async def create_topic(space_id: UUID, title: str) -> UUID:
            topic_id = uuid4()
            response = await owner.post(
                f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/topics",
                headers={"X-CSRF-Token": owner_csrf},
                json={
                    "id": str(topic_id),
                    "title": title,
                    "description": f"private description for {title}",
                },
            )
            assert response.status_code == 201, response.text
            return topic_id

        missing_csrf = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topics",
            json={"id": str(uuid4()), "title": "Missing CSRF", "description": ""},
        )
        assert missing_csrf.status_code == 403

        topic_a = await create_topic(private_space_id, "Foundations")
        topic_b = await create_topic(private_space_id, "Application")
        topic_c = await create_topic(private_space_id, "Evaluation")

        async def dependency(source: UUID, target: UUID):
            return await owner.post(
                f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topic-dependencies",
                headers={"X-CSRF-Token": owner_csrf},
                json={
                    "id": str(uuid4()),
                    "prerequisite_topic_id": str(source),
                    "dependent_topic_id": str(target),
                },
            )

        assert (await dependency(topic_a, topic_b)).status_code == 201
        assert (await dependency(topic_b, topic_c)).status_code == 201
        cycle = await dependency(topic_c, topic_a)
        assert cycle.status_code == 409
        assert cycle.json()["code"] == "RESOURCE_STATE_CONFLICT"

        shared_topic = await create_topic(shared_space_id, "User supplied shared topic")
        cross_space = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topic-dependencies",
            headers={"X-CSRF-Token": owner_csrf},
            json={
                "id": str(uuid4()),
                "prerequisite_topic_id": str(topic_a),
                "dependent_topic_id": str(shared_topic),
            },
        )
        assert cross_space.status_code == 404

        mastery_id, schedule_id = uuid4(), uuid4()
        confirmed = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topics/{topic_a}/mastery/confirmation",
            headers={"X-CSRF-Token": owner_csrf},
            json={
                "mastery_id": str(mastery_id),
                "schedule_id": str(schedule_id),
                "expected_version": 0,
                "confirmed_level": "exposed",
            },
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["mastery"]["suggested_level"] == "unknown"
        assert confirmed.json()["mastery"]["confirmed_level"] == "exposed"
        assert confirmed.json()["review_schedule"]["interval_days"] == 1

        async with session_factory() as db:
            service = MemoryService(Settings(), WorkspaceService(Settings()))
            suggested = await service.record_system_suggestion(
                db,
                workspace_id=workspace_id,
                space_id=private_space_id,
                topic_id=topic_a,
                user_id=owner_id,
                mastery_id=mastery_id,
                expected_version=1,
                suggested_level="proficient",
                suggested_reason="private derived assessment basis",
                request_id="memory-suggestion-test",
            )
            assert suggested.confirmed_level == "exposed"
            stored_schedule = await db.get(ReviewSchedule, schedule_id)
            assert stored_schedule is not None and stored_schedule.version == 1
            await db.commit()

        listed = await owner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topics"
        )
        by_id = {item["id"]: item for item in listed.json()["topics"]}
        assert by_id[str(topic_a)]["mastery"]["suggested_level"] == "proficient"
        assert by_id[str(topic_a)]["mastery"]["confirmed_level"] == "exposed"

        stale_confirmation = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topics/{topic_a}/mastery/confirmation",
            headers={"X-CSRF-Token": owner_csrf},
            json={
                "mastery_id": str(mastery_id),
                "schedule_id": str(schedule_id),
                "expected_version": 1,
                "confirmed_level": "mastered",
            },
        )
        assert stale_confirmation.status_code == 409

        reconfirmed = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{private_space_id}/topics/{topic_a}/mastery/confirmation",
            headers={"X-CSRF-Token": owner_csrf},
            json={
                "mastery_id": str(mastery_id),
                "schedule_id": str(schedule_id),
                "expected_version": 2,
                "confirmed_level": "familiar",
            },
        )
        assert reconfirmed.status_code == 200, reconfirmed.text
        assert reconfirmed.json()["mastery"]["suggested_level"] == "proficient"
        assert reconfirmed.json()["mastery"]["confirmed_level"] == "familiar"
        assert reconfirmed.json()["review_schedule"]["interval_days"] == 4

        viewer_topics = await viewer.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{shared_space_id}/topics"
        )
        assert viewer_topics.status_code == 200
        assert viewer_topics.json()["topics"][0]["mastery"] is None
        viewer_create = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{shared_space_id}/topics",
            headers={"X-CSRF-Token": viewer_csrf},
            json={"id": str(uuid4()), "title": "Forbidden graph edit", "description": ""},
        )
        assert viewer_create.status_code == 403
        viewer_mastery_id, viewer_schedule_id = uuid4(), uuid4()
        viewer_confirm = await viewer.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{shared_space_id}/topics/{shared_topic}/mastery/confirmation",
            headers={"X-CSRF-Token": viewer_csrf},
            json={
                "mastery_id": str(viewer_mastery_id),
                "schedule_id": str(viewer_schedule_id),
                "expected_version": 0,
                "confirmed_level": "practicing",
            },
        )
        assert viewer_confirm.status_code == 200, viewer_confirm.text
        owner_shared = await owner.get(
            f"/api/v1/workspaces/{workspace_id}/spaces/{shared_space_id}/topics"
        )
        assert owner_shared.json()["topics"][0]["mastery"] is None

    async with session_factory() as db:
        mastery = await db.get(MasteryRecord, mastery_id)
        schedule = await db.get(ReviewSchedule, schedule_id)
        edges = list(
            (
                await db.scalars(
                    select(TopicDependency).where(
                        TopicDependency.workspace_id == workspace_id
                    )
                )
            ).all()
        )
        assert mastery is not None and mastery.confirmed_level == "familiar"
        assert mastery.suggested_level == "proficient"
        assert schedule is not None and schedule.interval_days == 4
        assert len(edges) == 2
        audits = list(
            (
                await db.scalars(
                    select(AuditEvent).where(AuditEvent.workspace_id == workspace_id)
                )
            ).all()
        )
        serialized = " ".join(str(item.event_metadata) for item in audits)
        assert "private description" not in serialized
        assert "private derived assessment basis" not in serialized
