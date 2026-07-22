from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuthSession, PasswordCredential, User
from logion_api.main import app
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.models import AccountDeletionRequest
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


async def register(client: AsyncClient, label: str) -> tuple[UUID, str]:
    email = f"delete-{label}-{uuid4()}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "a-strong-password-123",
            "device_name": label,
        },
    )
    assert response.status_code == 201, response.text
    return UUID(response.json()["user"]["id"]), email


@pytest.mark.integration
@pytest.mark.asyncio
async def test_account_deletion_revokes_access_then_allows_explicit_cancel() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.174", 49014)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        user_id, email = await register(client, "cancel")
        request = await client.post(
            "/api/v1/account-deletion",
            headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
            json={"confirmation": "DELETE MY ACCOUNT"},
        )
        assert request.status_code == 202, request.text
        deletion = request.json()
        assert deletion["status"] == "pending"
        assert deletion["owned_workspace_ids"]
        assert "logion_access" not in client.cookies
        assert (await client.get("/api/v1/workspaces")).status_code == 401

        login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "recovery browser",
                "platform": "web",
            },
        )
        assert login.status_code == 200, login.text
        assert login.json()["user"]["status"] == "pending_deletion"
        assert (await client.get("/api/v1/workspaces")).status_code == 401
        status = await client.get("/api/v1/account-deletion")
        assert status.status_code == 200
        cancelled = await client.post(
            "/api/v1/account-deletion/cancel",
            headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
            json={
                "expected_version": status.json()["version"],
                "confirmation": "KEEP MY ACCOUNT",
            },
        )
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"
        assert (await client.get("/api/v1/workspaces")).status_code == 200

    async with session_factory() as db:
        user = await db.get(User, user_id)
        assert user is not None and user.status == "active"
        sessions = list(
            (await db.scalars(select(AuthSession).where(AuthSession.user_id == user_id))).all()
        )
        assert any(row.revoke_reason == "account_deletion" for row in sessions)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_account_deletion_blocks_shared_ownership_and_pseudonymizes_after_grace() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.175", 49015)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.176", 49016)),
            base_url=origin,
            headers={"Origin": origin},
        ) as member,
    ):
        owner_id, _owner_email = await register(owner, "blocked")
        member_id, _member_email = await register(member, "member")
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=member_id,
                    role="viewer",
                    status="active",
                )
            )
            await db.commit()
        blocked = await owner.post(
            "/api/v1/account-deletion",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"confirmation": "DELETE MY ACCOUNT"},
        )
        assert blocked.status_code == 409
        assert blocked.json()["code"] == "ACCOUNT_DELETION_OWNERSHIP_BLOCKED"

        user_id, original_email = await register(member, "physical")
        requested = await member.post(
            "/api/v1/account-deletion",
            headers={"X-CSRF-Token": member.cookies["logion_csrf"]},
            json={"confirmation": "DELETE MY ACCOUNT"},
        )
        assert requested.status_code == 202, requested.text
        deletion_id = UUID(requested.json()["id"])

    async with session_factory() as db:
        row = await db.get(AccountDeletionRequest, deletion_id)
        assert row is not None
        row.delete_after = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
    assert await AccountDeletionService(get_settings()).execute_next() is True
    async with session_factory() as db:
        user = await db.get(User, user_id)
        request = await db.get(AccountDeletionRequest, deletion_id)
        assert user is not None and user.status == "deleted"
        assert user.email != original_email and user.email.endswith("@invalid.example")
        assert user.email_verified_at is None
        assert request is not None and request.status == "completed"
        assert await db.get(PasswordCredential, user_id) is None
        assert not list(
            (await db.scalars(select(AuthSession).where(AuthSession.user_id == user_id))).all()
        )
