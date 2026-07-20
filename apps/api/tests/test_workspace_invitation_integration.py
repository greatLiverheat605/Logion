import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceInvitation, WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_workspace_invitation_is_email_bound_one_time_revocable_and_expiring() -> None:
    origin = "http://test"
    owner_email = f"invite-owner-{uuid4()}@example.com"
    invitee_email = f"invite-member-{uuid4()}@example.com"
    other_email = f"invite-other-{uuid4()}@example.com"
    clients = [
        AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{40 + index}", 44000 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index in range(4)
    ]
    owner, invitee_primary, invitee_secondary, other = clients
    try:
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": owner_email,
                "password": "a-strong-password-123",
                "device_name": "Invitation owner",
            },
        )
        assert owner_registration.status_code == 201, owner_registration.text
        owner_csrf = owner.cookies["logion_csrf"]
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])

        invitee_registration = await invitee_primary.post(
            "/api/v1/auth/register",
            json={
                "email": invitee_email,
                "password": "a-strong-password-123",
                "device_name": "Invitation recipient one",
            },
        )
        assert invitee_registration.status_code == 201, invitee_registration.text
        invitee_id = UUID(invitee_registration.json()["user"]["id"])
        invitee_primary_csrf = invitee_primary.cookies["logion_csrf"]
        second_login = await invitee_secondary.post(
            "/api/v1/auth/login",
            json={
                "email": invitee_email,
                "password": "a-strong-password-123",
                "device_name": "Invitation recipient two",
            },
        )
        assert second_login.status_code == 200, second_login.text
        invitee_secondary_csrf = invitee_secondary.cookies["logion_csrf"]

        other_registration = await other.post(
            "/api/v1/auth/register",
            json={
                "email": other_email,
                "password": "a-strong-password-123",
                "device_name": "Wrong invitation recipient",
            },
        )
        assert other_registration.status_code == 201, other_registration.text
        other_csrf = other.cookies["logion_csrf"]

        created = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/invitations",
            headers={"X-CSRF-Token": owner_csrf},
            json={"email": invitee_email.upper(), "role": "viewer"},
        )
        assert created.status_code == 201, created.text
        assert created.headers["cache-control"] == "no-store"
        invitation_id = UUID(created.json()["id"])
        token = created.json()["token"]
        assert len(token) >= 32

        async with session_factory() as db:
            stored = await db.get(WorkspaceInvitation, invitation_id)
            assert stored is not None
            assert stored.email_normalized == invitee_email.casefold()
            assert stored.token_hash != token
            assert token not in stored.token_hash
            created_audit = await db.scalar(
                select(AuditEvent).where(
                    AuditEvent.event_type == "workspace.invitation_created",
                    AuditEvent.target_id == invitation_id,
                )
            )
            assert created_audit is not None
            assert invitee_email.casefold() not in str(created_audit.event_metadata)
            assert token not in str(created_audit.event_metadata)

        wrong_account = await other.post(
            "/api/v1/invitations/accept",
            headers={"X-CSRF-Token": other_csrf},
            json={"token": token},
        )
        assert wrong_account.status_code == 404
        assert wrong_account.json()["code"] == "INVITATION_INVALID"

        first, second = await asyncio.gather(
            invitee_primary.post(
                "/api/v1/invitations/accept",
                headers={"X-CSRF-Token": invitee_primary_csrf},
                json={"token": token},
            ),
            invitee_secondary.post(
                "/api/v1/invitations/accept",
                headers={"X-CSRF-Token": invitee_secondary_csrf},
                json={"token": token},
            ),
        )
        assert sorted((first.status_code, second.status_code)) == [200, 404]
        accepted = first if first.status_code == 200 else second
        assert accepted.json()["role"] == "viewer"

        async with session_factory() as db:
            memberships = list(
                (
                    await db.scalars(
                        select(WorkspaceMembership).where(
                            WorkspaceMembership.workspace_id == workspace_id,
                            WorkspaceMembership.user_id == invitee_id,
                        )
                    )
                ).all()
            )
            assert len(memberships) == 1
            assert memberships[0].status == "active"
            assert memberships[0].role == "viewer"

        denied_inviter = await invitee_primary.post(
            f"/api/v1/workspaces/{workspace_id}/invitations",
            headers={"X-CSRF-Token": invitee_primary_csrf},
            json={"email": other_email, "role": "viewer"},
        )
        assert denied_inviter.status_code == 403
        assert denied_inviter.json()["code"] == "AUTHZ_PERMISSION_DENIED"

        revocable = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/invitations",
            headers={"X-CSRF-Token": owner_csrf},
            json={"email": other_email, "role": "reviewer"},
        )
        assert revocable.status_code == 201, revocable.text
        revoke = await owner.delete(
            f"/api/v1/workspaces/{workspace_id}/invitations/{revocable.json()['id']}",
            headers={"X-CSRF-Token": owner_csrf},
        )
        assert revoke.status_code == 200
        assert revoke.json()["status"] == "revoked"
        revoked_accept = await other.post(
            "/api/v1/invitations/accept",
            headers={"X-CSRF-Token": other_csrf},
            json={"token": revocable.json()["token"]},
        )
        assert revoked_accept.status_code == 404

        expiring = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/invitations",
            headers={"X-CSRF-Token": owner_csrf},
            json={"email": other_email, "role": "contributor"},
        )
        assert expiring.status_code == 201, expiring.text
        expiring_id = UUID(expiring.json()["id"])
        async with session_factory() as db:
            record = await db.get(WorkspaceInvitation, expiring_id)
            assert record is not None
            record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        expired_accept = await other.post(
            "/api/v1/invitations/accept",
            headers={"X-CSRF-Token": other_csrf},
            json={"token": expiring.json()["token"]},
        )
        assert expired_accept.status_code == 404
        async with session_factory() as db:
            expired = await db.get(WorkspaceInvitation, expiring_id)
            assert expired is not None
            assert expired.status == "expired"
    finally:
        for client in clients:
            await client.aclose()
