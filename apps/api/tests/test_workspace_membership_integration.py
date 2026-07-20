from datetime import UTC, datetime
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
async def test_membership_hierarchy_versions_and_live_revocation() -> None:
    origin = "http://test"
    labels = ("owner", "admin", "target", "outsider")
    clients = {
        label: AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{70 + index}", 47000 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index, label in enumerate(labels)
    }
    users: dict[str, UUID] = {}
    csrf: dict[str, str] = {}
    try:
        for label in labels:
            registered = await clients[label].post(
                "/api/v1/auth/register",
                json={
                    "email": f"membership-{label}-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": f"Membership {label}",
                },
            )
            assert registered.status_code == 201, registered.text
            users[label] = UUID(registered.json()["user"]["id"])
            csrf[label] = clients[label].cookies["logion_csrf"]

        owner_workspaces = await clients["owner"].get("/api/v1/workspaces")
        workspace_id = UUID(owner_workspaces.json()["workspaces"][0]["id"])
        now = datetime.now(UTC)
        async with session_factory() as db:
            owner_membership = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == users["owner"],
                )
            )
            assert owner_membership is not None
            admin_membership = WorkspaceMembership(
                workspace_id=workspace_id,
                user_id=users["admin"],
                role="admin",
                status="active",
                joined_at=now,
            )
            target_membership = WorkspaceMembership(
                workspace_id=workspace_id,
                user_id=users["target"],
                role="viewer",
                status="active",
                joined_at=now,
            )
            db.add_all((admin_membership, target_membership))
            await db.commit()
            owner_membership_id = owner_membership.id
            admin_membership_id = admin_membership.id
            target_membership_id = target_membership.id

        listed = await clients["owner"].get(f"/api/v1/workspaces/{workspace_id}/members")
        assert listed.status_code == 200, listed.text
        assert {UUID(member["user_id"]) for member in listed.json()["members"]} == {
            users["owner"],
            users["admin"],
            users["target"],
        }

        viewer_list = await clients["target"].get(f"/api/v1/workspaces/{workspace_id}/members")
        assert viewer_list.status_code == 403
        cross_tenant = await clients["outsider"].get(
            f"/api/v1/workspaces/{workspace_id}/members"
        )
        assert cross_tenant.status_code == 404

        self_change = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{admin_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 1, "role": "viewer"},
        )
        assert self_change.status_code == 403
        owner_change = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{owner_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 1, "role": "viewer"},
        )
        assert owner_change.status_code == 409
        assert owner_change.json()["code"] == "MEMBERSHIP_OWNER_PROTECTED"

        reviewer = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 1, "role": "reviewer"},
        )
        assert reviewer.status_code == 200, reviewer.text
        assert reviewer.json()["version"] == 2

        stale = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 1, "status": "suspended"},
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "MEMBERSHIP_VERSION_CONFLICT"

        suspended = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 2, "status": "suspended"},
        )
        assert suspended.status_code == 200
        assert suspended.json()["version"] == 3
        denied_live_session = await clients["target"].get(f"/api/v1/workspaces/{workspace_id}")
        assert denied_live_session.status_code == 404

        restored = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 3, "status": "active"},
        )
        assert restored.status_code == 200
        target_access = await clients["target"].get(f"/api/v1/workspaces/{workspace_id}")
        assert target_access.status_code == 200

        admin_escalation = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 4, "role": "admin"},
        )
        assert admin_escalation.status_code == 403

        promoted = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 4, "role": "admin"},
        )
        assert promoted.status_code == 200
        assert promoted.json()["version"] == 5

        peer_admin = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 5, "role": "viewer"},
        )
        assert peer_admin.status_code == 403

        revoked = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 5, "status": "revoked"},
        )
        assert revoked.status_code == 200
        assert revoked.json()["version"] == 6
        revoked_access = await clients["target"].get(f"/api/v1/workspaces/{workspace_id}")
        assert revoked_access.status_code == 404

        reactivated = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 6, "role": "editor", "status": "active"},
        )
        assert reactivated.status_code == 200
        assert reactivated.json()["version"] == 7
        restored_access = await clients["target"].get(f"/api/v1/workspaces/{workspace_id}")
        assert restored_access.status_code == 200

        final_update = await clients["admin"].post(
            f"/api/v1/workspaces/{workspace_id}/members/{target_membership_id}/update",
            headers={"X-CSRF-Token": csrf["admin"]},
            json={"expected_version": 7, "role": "viewer"},
        )
        assert final_update.status_code == 200

        async with session_factory() as db:
            audits = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(
                            AuditEvent.event_type.in_(
                                (
                                    "workspace.membership_updated",
                                    "workspace.membership_update_denied",
                                )
                            )
                        )
                    )
                ).all()
            )
            assert audits
            serialized_metadata = " ".join(str(audit.event_metadata) for audit in audits)
            assert "@example.com" not in serialized_metadata
    finally:
        for client in clients.values():
            await client.aclose()
