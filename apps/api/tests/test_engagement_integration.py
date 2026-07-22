from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.engagement.models import CalendarFeed, Notification
from logion_api.engagement.service import EngagementService
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_search_notifications_and_revocable_calendar_respect_privacy() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.168", 49008)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.169", 49009)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        registrations = []
        for client, label in ((owner, "owner"), (viewer, "viewer")):
            registrations.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"engagement-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        owner_id = UUID(registrations[0].json()["user"]["id"])
        viewer_id = UUID(registrations[1].json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
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
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        goal_id, phase_id = uuid4(), uuid4()
        goal = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers=csrf,
            json={
                "goal_id": str(goal_id),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Private searchable goal",
                "description": "Owner-only planning context",
                "desired_outcome": "A user-defined output",
                "weekly_minutes": 180,
                "target_date": None,
                "phases": [
                    {
                        "id": str(phase_id),
                        "title": "Private phase",
                        "description": "Private phase detail",
                        "position": 0,
                        "estimated_minutes": 300,
                        "acceptance_criteria": ["Owner criterion"],
                    }
                ],
            },
        )
        assert goal.status_code == 201, goal.text
        task_id = uuid4()
        task = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers=csrf,
            json={
                "id": str(task_id),
                "goal_id": str(goal_id),
                "phase_id": str(phase_id),
                "title": "Calendar-safe task title",
                "description": "Task details remain out of calendar",
                "priority": 2,
                "estimated_minutes": 45,
                "due_at": "2027-02-03T10:30:00Z",
            },
        )
        assert task.status_code == 201, task.text
        private_marker = f"private-marker-{uuid4().hex}"
        note = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes",
            headers=csrf,
            json={
                "id": str(uuid4()),
                "task_id": None,
                "title": "Private searchable note",
                "markdown_body": f"Sensitive body {private_marker}",
            },
        )
        assert note.status_code == 201, note.text

        search_url = f"/api/v1/workspaces/{workspace_id}/search"
        owner_search = await owner.post(
            search_url,
            headers=csrf,
            json={"query": private_marker, "object_types": ["note"], "limit": 10},
        )
        assert owner_search.status_code == 200, owner_search.text
        assert owner_search.json()["results"][0]["permission_source"] == "private_owner"
        viewer_search = await viewer.post(
            search_url,
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={"query": private_marker, "object_types": ["note"], "limit": 10},
        )
        assert viewer_search.status_code == 200
        assert viewer_search.json()["results"] == []
        literal_wildcard = await owner.post(
            search_url,
            headers=csrf,
            json={"query": "%_", "object_types": ["note"], "limit": 10},
        )
        assert literal_wildcard.status_code == 200
        assert literal_wildcard.json()["results"] == []

        preferences_url = f"/api/v1/workspaces/{workspace_id}/notification-preferences"
        default_preferences = await owner.get(preferences_url)
        assert default_preferences.status_code == 200
        assert default_preferences.json()["version"] == 0
        blocked_security_disable = await owner.put(
            preferences_url,
            headers=csrf,
            json={
                "expected_version": None,
                "enabled_categories": ["ai"],
                "timezone": "UTC",
                "quiet_start_minute": None,
                "quiet_end_minute": None,
            },
        )
        assert blocked_security_disable.status_code == 422
        preferences = await owner.put(
            preferences_url,
            headers=csrf,
            json={
                "expected_version": None,
                "enabled_categories": ["security", "ai"],
                "timezone": "Asia/Shanghai",
                "quiet_start_minute": 1320,
                "quiet_end_minute": 420,
            },
        )
        assert preferences.status_code == 200, preferences.text

        async with session_factory() as db:
            await EngagementService.emit(
                db,
                workspace_id=workspace_id,
                recipient_user_id=owner_id,
                category="learning",
                title="Disabled learning notice",
                summary="Should not be stored",
                dedupe_key=f"learning:{uuid4()}",
            )
            await EngagementService.emit(
                db,
                workspace_id=workspace_id,
                recipient_user_id=owner_id,
                category="security",
                title="Security notice",
                summary="Minimal security summary",
                dedupe_key=f"security:{uuid4()}",
            )
            await db.commit()
        notifications_url = f"/api/v1/workspaces/{workspace_id}/notifications"
        notifications = await owner.get(notifications_url)
        assert notifications.status_code == 200
        assert [row["category"] for row in notifications.json()["notifications"]] == ["security"]
        notification = notifications.json()["notifications"][0]
        assert (await viewer.get(notifications_url)).json()["notifications"] == []
        marked = await owner.post(
            f"{notifications_url}/{notification['id']}/read",
            headers=csrf,
            json={"read": True},
        )
        assert marked.status_code == 200
        assert marked.json()["read_at"] is not None

        feeds_url = f"/api/v1/workspaces/{workspace_id}/calendar-feeds"
        feed_id = uuid4()
        feed = await owner.post(
            feeds_url,
            headers=csrf,
            json={"id": str(feed_id), "name": "My Logion dates"},
        )
        assert feed.status_code == 201, feed.text
        token = feed.json()["token"]
        assert token not in (await owner.get(feeds_url)).text
        calendar = await viewer.get(f"/api/v1/calendars/{token}.ics")
        assert calendar.status_code == 200, calendar.text
        assert calendar.headers["cache-control"] == "private, no-store"
        assert "BEGIN:VCALENDAR" in calendar.text
        assert "Calendar-safe task title" in calendar.text
        assert private_marker not in calendar.text
        revoked = await owner.post(
            f"{feeds_url}/{feed_id}/revoke",
            headers=csrf,
            json={"expected_version": 1},
        )
        assert revoked.status_code == 200
        assert (await viewer.get(f"/api/v1/calendars/{token}.ics")).status_code == 404

    async with session_factory() as db:
        feed_row = await db.get(CalendarFeed, feed_id)
        assert feed_row is not None and feed_row.token_hash != token
        stored_notifications = list(
            (
                await db.scalars(
                    select(Notification).where(Notification.workspace_id == workspace_id)
                )
            ).all()
        )
        assert len(stored_notifications) == 1
        audits = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        audit_text = " ".join(str(row.event_metadata) for row in audits)
        assert private_marker not in audit_text
        assert token not in audit_text
