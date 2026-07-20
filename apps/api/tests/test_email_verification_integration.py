import asyncio
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.dependencies import get_security
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import (
    AuditEvent,
    EmailOutbox,
    IdentityActionToken,
    PasswordCredential,
    User,
)
from logion_api.main import app
from logion_api.workspaces.models import Space, WorkspaceMembership
from sqlalchemy import func, select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_email_registration_is_uniform_encrypted_single_use_and_no_auto_login() -> None:
    origin = "http://test"
    email = f"verify-{uuid4()}@example.com"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.210", 53000)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        first = await client.post("/api/v1/auth/registrations", json={"email": email})
        async with session_factory() as db:
            initial_user = await db.scalar(
                select(User).where(User.email_normalized == email.casefold())
            )
            assert initial_user is not None
            initial_outbox = await db.scalar(
                select(EmailOutbox).where(EmailOutbox.user_id == initial_user.id)
            )
            assert initial_outbox is not None
            revoked_token = EmailDeliveryCipher(get_settings()).decrypt(initial_outbox)["token"]
        second = await client.post("/api/v1/auth/registrations", json={"email": email})

        assert first.status_code == second.status_code == 202
        assert first.json() == second.json() == {"status": "ok"}
        assert first.headers["cache-control"] == "no-store"
        assert not first.headers.get_list("set-cookie")

        async with session_factory() as db:
            user = await db.scalar(select(User).where(User.email_normalized == email.casefold()))
            assert user is not None
            user_id = user.id
            assert user.email_verified_at is None
            assert await db.get(PasswordCredential, user_id) is None
            assert (
                await db.scalar(
                    select(func.count(WorkspaceMembership.id)).where(
                        WorkspaceMembership.user_id == user_id
                    )
                )
                == 0
            )
            actions = list(
                (
                    await db.scalars(
                        select(IdentityActionToken)
                        .where(IdentityActionToken.user_id == user_id)
                        .order_by(
                            IdentityActionToken.created_at.asc(),
                            IdentityActionToken.id.asc(),
                        )
                    )
                ).all()
            )
            outboxes = list(
                (
                    await db.scalars(
                        select(EmailOutbox)
                        .where(EmailOutbox.user_id == user_id)
                        .order_by(EmailOutbox.created_at.asc(), EmailOutbox.id.asc())
                    )
                ).all()
            )
            assert len(actions) == len(outboxes) == 2
            assert actions[0].revoked_at is not None
            assert actions[1].revoked_at is None
            assert outboxes[0].status == "dead"
            assert outboxes[0].payload_ciphertext == b""
            latest_outbox = outboxes[1]
            payload = EmailDeliveryCipher(get_settings()).decrypt(latest_outbox)
            token = payload["token"]
            assert payload["recipient"] == email
            assert email.encode() not in latest_outbox.payload_ciphertext
            assert token.encode() not in latest_outbox.payload_ciphertext
            db.add(
                PasswordCredential(
                    user_id=user_id,
                    password_hash=get_security().hash_password("attacker-password-123"),
                )
            )
            await db.commit()

        revoked = await client.post(
            "/api/v1/auth/email-verification/confirmations",
            json={"token": revoked_token, "password": "verified-password-123"},
        )
        assert revoked.status_code == 400

        confirmations = await asyncio.gather(
            client.post(
                "/api/v1/auth/email-verification/confirmations",
                json={"token": token, "password": "verified-password-123"},
            ),
            client.post(
                "/api/v1/auth/email-verification/confirmations",
                json={"token": token, "password": "verified-password-123"},
            ),
        )
        assert sorted(item.status_code for item in confirmations) == [200, 400]
        confirmed = next(item for item in confirmations if item.status_code == 200)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json() == {"status": "ok"}
        assert confirmed.headers["cache-control"] == "no-store"
        assert not confirmed.headers.get_list("set-cookie")

        replay = await client.post(
            "/api/v1/auth/email-verification/confirmations",
            json={"token": token, "password": "another-password-123"},
        )
        assert replay.status_code == 400
        assert replay.json()["code"] == "AUTH_EMAIL_ACTION_INVALID"

        async with session_factory() as db:
            user = await db.get(User, user_id)
            assert user is not None
            assert user.email_verified_at is not None
            assert await db.get(PasswordCredential, user_id) is not None
            memberships = list(
                (
                    await db.scalars(
                        select(WorkspaceMembership).where(
                            WorkspaceMembership.user_id == user_id,
                            WorkspaceMembership.role == "owner",
                        )
                    )
                ).all()
            )
            assert len(memberships) == 1
            private_spaces = int(
                await db.scalar(
                    select(func.count(Space.id)).where(
                        Space.workspace_id == memberships[0].workspace_id,
                        Space.owner_user_id == user_id,
                        Space.visibility == "private",
                    )
                )
                or 0
            )
            assert private_spaces == 1
            stored_action = await db.get(IdentityActionToken, actions[1].id)
            stored_outbox = await db.get(EmailOutbox, latest_outbox.id)
            assert stored_action is not None and stored_action.used_at is not None
            assert stored_outbox is not None and stored_outbox.status == "dead"
            assert stored_outbox.payload_ciphertext == b""
            audits = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(AuditEvent.target_id == user_id)
                    )
                ).all()
            )
            audit_text = json.dumps(
                [event.event_metadata for event in audits],
                sort_keys=True,
            )
            assert token not in audit_text
            assert email not in audit_text

        attacker_login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "attacker-password-123",
                "device_name": "Attacker browser",
            },
        )
        assert attacker_login.status_code == 401

        logged_in = await client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "verified-password-123",
                "device_name": "Verified browser",
            },
        )
        assert logged_in.status_code == 200, logged_in.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_registration_hides_verified_accounts_and_expired_tokens() -> None:
    origin = "http://test"
    verified_email = f"existing-{uuid4()}@example.com"
    expiring_email = f"expiring-{uuid4()}@example.com"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.211", 53001)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        legacy = await client.post(
            "/api/v1/auth/register",
            json={
                "email": verified_email,
                "password": "legacy-password-123",
                "device_name": "Legacy browser",
            },
        )
        assert legacy.status_code == 201, legacy.text
        verified_id = UUID(legacy.json()["user"]["id"])

        hidden = await client.post(
            "/api/v1/auth/registrations",
            json={"email": verified_email},
        )
        fresh = await client.post(
            "/api/v1/auth/registrations",
            json={"email": expiring_email},
        )
        assert hidden.status_code == fresh.status_code == 202
        assert hidden.json() == fresh.json() == {"status": "ok"}

        async with session_factory() as db:
            assert (
                await db.scalar(
                    select(func.count(EmailOutbox.id)).where(EmailOutbox.user_id == verified_id)
                )
                == 0
            )
            expiring_user = await db.scalar(
                select(User).where(User.email_normalized == expiring_email.casefold())
            )
            assert expiring_user is not None
            action = await db.scalar(
                select(IdentityActionToken).where(
                    IdentityActionToken.user_id == expiring_user.id,
                    IdentityActionToken.revoked_at.is_(None),
                )
            )
            outbox = await db.scalar(
                select(EmailOutbox).where(EmailOutbox.user_id == expiring_user.id)
            )
            assert action is not None and outbox is not None
            token = EmailDeliveryCipher(get_settings()).decrypt(outbox)["token"]
            action.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()

        expired = await client.post(
            "/api/v1/auth/email-verification/confirmations",
            json={"token": token, "password": "verified-password-123"},
        )
        assert expired.status_code == 400
        assert expired.json()["code"] == "AUTH_EMAIL_ACTION_INVALID"

        unverified_login = await client.post(
            "/api/v1/auth/login",
            json={
                "email": expiring_email,
                "password": "verified-password-123",
                "device_name": "Unverified browser",
            },
        )
        assert unverified_login.status_code == 401
