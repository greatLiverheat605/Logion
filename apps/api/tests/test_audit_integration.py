from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_audit_queries_are_scoped_paginated_signed_and_minimized() -> None:
    origin = "http://test"
    labels = ("owner", "admin", "outsider")
    clients = {
        label: AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{120 + index}", 52000 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index, label in enumerate(labels)
    }
    users: dict[str, UUID] = {}
    try:
        for label in labels:
            registered = await clients[label].post(
                "/api/v1/auth/register",
                json={
                    "email": f"audit-{label}-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": f"Audit {label}",
                },
            )
            assert registered.status_code == 201, registered.text
            users[label] = UUID(registered.json()["user"]["id"])

        owner_workspace_id = UUID(
            (await clients["owner"].get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        outsider_workspace_id = UUID(
            (await clients["outsider"].get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        now = datetime.now(UTC).replace(microsecond=0)
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=owner_workspace_id,
                    user_id=users["admin"],
                    role="admin",
                    status="active",
                    joined_at=now,
                )
            )
            event_ids = [UUID(f"00000000-0000-0000-0000-{index:012d}") for index in range(1, 6)]
            event_times = [
                now - timedelta(minutes=3),
                now - timedelta(minutes=2),
                now - timedelta(minutes=1),
                now,
                now,
            ]
            events = zip(event_ids, event_times, strict=True)
            for index, (event_id, occurred_at) in enumerate(events):
                db.add(
                    AuditEvent(
                        id=event_id,
                        workspace_id=owner_workspace_id,
                        actor_id=users["owner"] if index % 2 == 0 else users["admin"],
                        request_id=f"internal-request-{index}",
                        event_type="workspace.audit_test",
                        target_type="workspace_membership",
                        target_id=None,
                        result="denied" if index == 0 else "success",
                        event_metadata={
                            "email": "secret@example.com",
                            "token": "must-not-leak",
                        },
                        occurred_at=occurred_at,
                    )
                )
            db.add_all(
                (
                    AuditEvent(
                        workspace_id=outsider_workspace_id,
                        actor_id=users["outsider"],
                        request_id="other-workspace",
                        event_type="workspace.audit_test",
                        target_type="workspace",
                        result="success",
                        occurred_at=now,
                    ),
                    AuditEvent(
                        actor_id=users["owner"],
                        request_id="owner-identity",
                        event_type="identity.audit_test",
                        target_type="auth_session",
                        result="success",
                        occurred_at=now,
                    ),
                    AuditEvent(
                        actor_id=users["admin"],
                        request_id="admin-identity",
                        event_type="identity.audit_test",
                        target_type="auth_session",
                        result="success",
                        occurred_at=now,
                    ),
                )
            )
            await db.commit()

        admin_denied = await clients["admin"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events"
        )
        assert admin_denied.status_code == 403
        outsider_denied = await clients["outsider"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events"
        )
        assert outsider_denied.status_code == 404

        collected: list[dict[str, object]] = []
        cursor: str | None = None
        first_cursor: str | None = None
        while True:
            params = {"page_size": "2", "event_type": "workspace.audit_test"}
            if cursor is not None:
                params["cursor"] = cursor
            page = await clients["owner"].get(
                f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
                params=params,
            )
            assert page.status_code == 200, page.text
            assert page.headers["cache-control"] == "no-store"
            serialized = page.text
            assert "event_metadata" not in serialized
            assert "request_id" not in serialized
            assert "secret@example.com" not in serialized
            assert "must-not-leak" not in serialized
            collected.extend(page.json()["events"])
            cursor = page.json()["next_cursor"]
            first_cursor = first_cursor or cursor
            if cursor is None:
                break

        assert len(collected) == 5
        assert len({event["id"] for event in collected}) == 5
        assert [event["id"] for event in collected[:2]] == [str(event_ids[4]), str(event_ids[3])]

        assert first_cursor is not None
        filter_reuse = await clients["owner"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
            params={"cursor": first_cursor, "event_type": "workspace.created"},
        )
        assert filter_reuse.status_code == 400
        replacement = "A" if first_cursor[len(first_cursor) // 2] != "A" else "B"
        tampered = (
            first_cursor[: len(first_cursor) // 2]
            + replacement
            + first_cursor[len(first_cursor) // 2 + 1 :]
        )
        tamper_response = await clients["owner"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
            params={"cursor": tampered, "event_type": "workspace.audit_test"},
        )
        assert tamper_response.status_code == 400

        denied_only = await clients["owner"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
            params={"event_type": "workspace.audit_test", "result": "denied"},
        )
        assert denied_only.status_code == 200
        assert [event["result"] for event in denied_only.json()["events"]] == ["denied"]

        time_filtered = await clients["owner"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
            params={
                "event_type": "workspace.audit_test",
                "occurred_after": (now - timedelta(seconds=1)).isoformat(),
                "occurred_before": (now + timedelta(seconds=1)).isoformat(),
            },
        )
        assert time_filtered.status_code == 200
        assert len(time_filtered.json()["events"]) == 2
        invalid_time_range = await clients["owner"].get(
            f"/api/v1/workspaces/{owner_workspace_id}/audit-events",
            params={
                "occurred_after": now.isoformat(),
                "occurred_before": (now - timedelta(seconds=1)).isoformat(),
            },
        )
        assert invalid_time_range.status_code == 422
        assert invalid_time_range.json()["code"] == "AUDIT_RANGE_INVALID"

        personal = await clients["owner"].get(
            "/api/v1/audit/me",
            params={"event_type": "identity.audit_test"},
        )
        assert personal.status_code == 200
        assert personal.headers["cache-control"] == "no-store"
        assert len(personal.json()["events"]) == 1
        assert UUID(personal.json()["events"][0]["actor_id"]) == users["owner"]
        workspace_event_not_personal = await clients["owner"].get(
            "/api/v1/audit/me",
            params={"event_type": "workspace.audit_test"},
        )
        assert workspace_event_not_personal.status_code == 200
        assert workspace_event_not_personal.json()["events"] == []

        async with session_factory() as db:
            stored = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(AuditEvent.event_type == "workspace.audit_test")
                    )
                ).all()
            )
            assert len(stored) == 6
    finally:
        for client in clients.values():
            await client.aclose()
