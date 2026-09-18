import asyncio
from datetime import UTC, datetime, timedelta
from itertools import count
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.engagement.models import Notification, NotificationPreference
from logion_api.identity.models import User
from logion_api.main import app
from logion_api.memory.models import ReviewSchedule, Topic
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_worker.review_reminders import emit_due_review_reminders
from sqlalchemy import select

NOW = datetime(2026, 9, 18, 1, tzinfo=UTC)
CLIENT_ADDRESSES = count(200)


async def seed() -> tuple[UUID, UUID, UUID, UUID, UUID]:
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(f"192.0.2.{next(CLIENT_ADDRESSES)}", 49008)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as client:
        response = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"review-reminder-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Reminder test",
            },
        )
        assert response.status_code == 201, response.text
        user_id = UUID(response.json()["user"]["id"])
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )
    topic_id, schedule_id = uuid4(), uuid4()
    async with session_factory() as db:
        db.add(
            Topic(
                id=topic_id,
                workspace_id=workspace_id,
                space_id=space_id,
                title="Private title must not enter reminder",
                created_by=user_id,
                updated_by=user_id,
            )
        )
        await db.flush()
        db.add(
            ReviewSchedule(
                id=schedule_id,
                workspace_id=workspace_id,
                space_id=space_id,
                topic_id=topic_id,
                user_id=user_id,
                source="manual",
                interval_days=1,
                next_review_at=NOW - timedelta(days=1),
            )
        )
        db.add(
            NotificationPreference(
                workspace_id=workspace_id,
                user_id=user_id,
                enabled_categories=["security", "learning"],
                timezone="Asia/Shanghai",
            )
        )
        await db.commit()
    return workspace_id, user_id, space_id, topic_id, schedule_id


async def emit(now: datetime) -> None:
    async with session_factory() as db:
        await emit_due_review_reminders(db, now)
        await db.commit()


async def reminders(workspace_id: UUID) -> list[Notification]:
    async with session_factory() as db:
        return list(
            (
                await db.scalars(
                    select(Notification).where(
                        Notification.workspace_id == workspace_id,
                        Notification.target_type == "review",
                    )
                )
            ).all()
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_due_digest_defers_quiet_time_dedupes_concurrent_runs_and_obeys_preferences() -> None:
    workspace_id, user_id, _space_id, _topic_id, _schedule_id = await seed()
    async with session_factory() as db:
        preference = await db.get(NotificationPreference, (workspace_id, user_id))
        assert preference
        preference.quiet_start_minute, preference.quiet_end_minute = 480, 600
        await db.commit()
    await emit(NOW)  # 09:00 Asia/Shanghai
    assert await reminders(workspace_id) == []
    await asyncio.gather(emit(NOW + timedelta(hours=1)), emit(NOW + timedelta(hours=1)))
    rows = await reminders(workspace_id)
    assert len(rows) == 1
    assert "1 个知识点" in rows[0].summary
    assert "Private title" not in rows[0].summary
    await emit(NOW + timedelta(hours=14))  # Still same local day
    assert len(await reminders(workspace_id)) == 1
    await emit(NOW + timedelta(hours=15))  # New local day, before quiet hours
    assert len(await reminders(workspace_id)) == 2
    async with session_factory() as db:
        preference = await db.get(NotificationPreference, (workspace_id, user_id))
        assert preference
        preference.enabled_categories = ["security"]
        await db.commit()
    await emit(NOW + timedelta(days=2, hours=1))
    assert len(await reminders(workspace_id)) == 2


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "state",
    [
        "completed",
        "skipped",
        "in_progress",
        "future",
        "schedule_deleted",
        "topic_deleted",
        "space_archived",
        "workspace_archived",
        "member_removed",
        "user_disabled",
        "private_other_owner",
    ],
)
async def test_due_digest_rechecks_current_schedule_and_authorization(state: str) -> None:
    workspace_id, user_id, space_id, topic_id, schedule_id = await seed()
    async with session_factory() as db:
        schedule = await db.get(ReviewSchedule, schedule_id)
        topic = await db.get(Topic, topic_id)
        space = await db.get(Space, space_id)
        workspace = await db.get(Workspace, workspace_id)
        user = await db.get(User, user_id)
        member = await db.scalar(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == user_id,
            )
        )
        assert schedule and topic and space and workspace and user and member
        if state in {"completed", "skipped", "in_progress"}:
            schedule.status = state
        elif state == "future":
            schedule.next_review_at = NOW + timedelta(days=1)
        elif state == "schedule_deleted":
            schedule.deleted_at = NOW
        elif state == "topic_deleted":
            topic.deleted_at = NOW
        elif state == "space_archived":
            space.status = "archived"
        elif state == "workspace_archived":
            workspace.status = "suspended"
        elif state == "member_removed":
            member.status = "revoked"
        elif state == "user_disabled":
            user.status = "suspended"
        else:
            # A personal schedule must not expose a space whose ownership changed.
            email = f"other-{uuid4()}@example.com"
            other = User(id=uuid4(), email=email, email_normalized=email)
            db.add(other)
            await db.flush()
            space.owner_user_id = other.id
        await db.commit()
    await emit(NOW)
    assert await reminders(workspace_id) == []
