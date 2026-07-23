import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Attachment
from logion_api.db import session_factory
from logion_api.identity.models import AuthSession, PasswordCredential, User
from logion_api.main import app
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.models import AccountDeletionRequest
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


def path_exists(path: Path) -> bool:
    return path.exists()


def path_is_file(path: Path) -> bool:
    return path.is_file()


def verified_attachment_path(root: str, workspace_id: UUID, attachment_id: UUID) -> Path:
    return Path(root).resolve() / "verified" / str(workspace_id) / str(attachment_id)


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
        restricted = await client.get("/api/v1/workspaces")
        assert restricted.status_code == 403
        assert restricted.json()["code"] == "AUTH_ACCOUNT_PENDING_DELETION"
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
async def test_account_deletion_revokes_pending_workspace_invitations() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.177", 49017)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.178", 49018)),
            base_url=origin,
            headers={"Origin": origin},
        ) as recipient,
    ):
        await register(owner, "invitation-owner")
        _recipient_id, recipient_email = await register(recipient, "invitation-recipient")
        workspace_id = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        invitation = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/invitations",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"email": recipient_email, "role": "viewer"},
        )
        assert invitation.status_code == 201, invitation.text
        token = invitation.json()["token"]

        requested = await owner.post(
            "/api/v1/account-deletion",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"confirmation": "DELETE MY ACCOUNT"},
        )
        assert requested.status_code == 202, requested.text

        accepted = await recipient.post(
            "/api/v1/invitations/accept",
            headers={"X-CSRF-Token": recipient.cookies["logion_csrf"]},
            json={"token": token},
        )
        assert accepted.status_code == 404
        assert accepted.json()["code"] == "INVITATION_INVALID"


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
        physical_workspace = UUID(
            (await member.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        physical_space = UUID(
            (await member.get(f"/api/v1/workspaces/{physical_workspace}/spaces")).json()["spaces"][
                0
            ]["id"]
        )
        physical_csrf = {"X-CSRF-Token": member.cookies["logion_csrf"]}
        note_id, attachment_id = uuid4(), uuid4()
        note = await member.post(
            f"/api/v1/workspaces/{physical_workspace}/spaces/{physical_space}/notes",
            headers=physical_csrf,
            json={"id": str(note_id), "title": "Deletion attachment", "markdown_body": ""},
        )
        assert note.status_code == 201, note.text
        attachment_content = b"deletion attachment"
        attachment_base = (
            f"/api/v1/workspaces/{physical_workspace}/spaces/{physical_space}/attachments"
        )
        initiated = await member.post(
            f"{attachment_base}/init",
            headers=physical_csrf,
            json={
                "id": str(attachment_id),
                "target_type": "note",
                "target_id": str(note_id),
                "filename": "deletion.txt",
                "declared_mime": "text/plain",
                "size_bytes": len(attachment_content),
                "sha256": hashlib.sha256(attachment_content).hexdigest(),
            },
        )
        assert initiated.status_code == 201, initiated.text
        uploaded = await member.put(
            f"{attachment_base}/{attachment_id}/content",
            headers={**physical_csrf, "Content-Type": "application/octet-stream"},
            content=attachment_content,
        )
        assert uploaded.status_code == 200, uploaded.text
        completed = await member.post(
            f"{attachment_base}/{attachment_id}/complete",
            headers=physical_csrf,
            json={"expected_version": uploaded.json()["version"]},
        )
        assert completed.status_code == 200, completed.text
        attachment_path = verified_attachment_path(
            get_settings().attachment_root,
            physical_workspace,
            attachment_id,
        )
        assert path_is_file(attachment_path)
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
        assert await db.get(Attachment, attachment_id) is None
        assert not path_exists(attachment_path)
        assert await db.get(PasswordCredential, user_id) is None
        assert not list(
            (await db.scalars(select(AuthSession).where(AuthSession.user_id == user_id))).all()
        )
