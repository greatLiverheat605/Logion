import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.dependencies import get_security
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import (
    AuditEvent,
    AuthSession,
    Device,
    EmailOutbox,
    IdentityActionToken,
    RecoveryCode,
    RefreshToken,
    TotpCredential,
    User,
)
from logion_api.identity.totp import TotpSecretCipher
from logion_api.main import app
from sqlalchemy import func, select


async def _latest_recovery(user_id: UUID) -> tuple[IdentityActionToken, EmailOutbox, str]:
    async with session_factory() as db:
        action = await db.scalar(
            select(IdentityActionToken)
            .where(
                IdentityActionToken.user_id == user_id,
                IdentityActionToken.purpose == "password_recovery",
            )
            .order_by(IdentityActionToken.created_at.desc(), IdentityActionToken.id.desc())
        )
        assert action is not None
        outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.action_token_id == action.id)
        )
        assert outbox is not None
        token = EmailDeliveryCipher(get_settings()).decrypt(outbox)["token"]
        return action, outbox, token


@pytest.mark.integration
@pytest.mark.asyncio
async def test_password_recovery_is_uniform_revokes_sessions_and_notifies() -> None:
    origin = "http://test"
    email = f"recovery-{uuid4()}@example.com"
    clients = [
        AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{220 + index}", 54000 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index in range(2)
    ]
    try:
        registered = await clients[0].post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "Original browser",
            },
        )
        assert registered.status_code == 201, registered.text
        user_id = UUID(registered.json()["user"]["id"])
        second_login = await clients[1].post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "Second browser",
            },
        )
        assert second_login.status_code == 200

        existing = await clients[0].post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        missing = await clients[0].post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": f"missing-{uuid4()}@example.com"},
        )
        assert existing.status_code == missing.status_code == 202
        assert existing.json() == missing.json() == {"status": "ok"}
        assert existing.headers["cache-control"] == "no-store"

        action, recovery_outbox, token = await _latest_recovery(user_id)
        completed = await clients[0].post(
            "/api/v1/auth/password-recovery/completions",
            json={"token": token, "new_password": "replacement-password-123"},
        )
        assert completed.status_code == 200, completed.text
        assert completed.headers["cache-control"] == "no-store"
        assert any("Max-Age=0" in value for value in completed.headers.get_list("set-cookie"))

        assert (await clients[1].get("/api/v1/auth/me")).status_code == 401
        old_password = await clients[1].post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "Old password",
            },
        )
        assert old_password.status_code == 401
        new_password = await clients[1].post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "replacement-password-123",
                "device_name": "Recovered browser",
            },
        )
        assert new_password.status_code == 200

        replay = await clients[0].post(
            "/api/v1/auth/password-recovery/completions",
            json={"token": token, "new_password": "replayed-password-123"},
        )
        assert replay.status_code == 400
        assert replay.json()["code"] == "AUTH_PASSWORD_RECOVERY_INVALID"

        async with session_factory() as db:
            stored_action = await db.get(IdentityActionToken, action.id)
            stored_recovery_outbox = await db.get(EmailOutbox, recovery_outbox.id)
            assert stored_action is not None and stored_action.used_at is not None
            assert stored_recovery_outbox is not None
            assert stored_recovery_outbox.status == "dead"
            assert stored_recovery_outbox.payload_ciphertext == b""
            sessions = list(
                (
                    await db.scalars(select(AuthSession).where(AuthSession.user_id == user_id))
                ).all()
            )
            assert any(session.revoke_reason == "password_recovery" for session in sessions)
            assert all(session.revoked_at is not None for session in sessions)
            assert (
                await db.scalar(
                    select(func.count(RefreshToken.id))
                    .join(AuthSession, AuthSession.id == RefreshToken.session_id)
                    .where(
                        AuthSession.user_id == user_id,
                        RefreshToken.status == "active",
                    )
                )
                == 0
            )
            devices = list(
                (await db.scalars(select(Device).where(Device.user_id == user_id))).all()
            )
            assert len(devices) >= 2
            assert all(device.revoked_at is None for device in devices)
            assert (
                await db.scalar(
                    select(func.count(EmailOutbox.id)).where(
                        EmailOutbox.user_id == user_id,
                        EmailOutbox.purpose == "security_notification",
                    )
                )
                == 1
            )
            notification = await db.scalar(
                select(EmailOutbox).where(
                    EmailOutbox.user_id == user_id,
                    EmailOutbox.purpose == "security_notification",
                )
            )
            assert notification is not None
            notification_payload = EmailDeliveryCipher(get_settings()).decrypt(notification)
            assert notification_payload == {
                "event": "password_recovery_completed",
                "recipient": email,
            }
            assert token.encode() not in notification.payload_ciphertext
            audit_events = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(
                            AuditEvent.target_id.in_((user_id, action.id))
                        )
                    )
                ).all()
            )
            serialized_audit = repr([event.event_metadata for event in audit_events])
            assert token not in serialized_audit
            assert "replacement-password-123" not in serialized_audit
    finally:
        for client in clients:
            await client.aclose()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_password_recovery_request_hides_suspended_and_unverified_accounts() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.229", 54099)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        account_ids: dict[str, UUID] = {}
        for state in ("active", "suspended", "unverified"):
            email = f"recovery-{state}-{uuid4()}@example.com"
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "original-password-123",
                    "device_name": f"{state} browser",
                },
            )
            assert registered.status_code == 201
            account_ids[state] = UUID(registered.json()["user"]["id"])

        async with session_factory() as db:
            suspended = await db.get(User, account_ids["suspended"])
            unverified = await db.get(User, account_ids["unverified"])
            assert suspended is not None and unverified is not None
            suspended.status = "suspended"
            unverified.email_verified_at = None
            await db.commit()

        responses = []
        for user_id in account_ids.values():
            async with session_factory() as db:
                user = await db.get(User, user_id)
                assert user is not None
                email = user.email
            responses.append(
                await client.post(
                    "/api/v1/auth/password-recovery/requests",
                    json={"email": email},
                )
            )
        responses.append(
            await client.post(
                "/api/v1/auth/password-recovery/requests",
                json={"email": f"recovery-missing-{uuid4()}@example.com"},
            )
        )
        assert all(response.status_code == 202 for response in responses)
        assert all(response.json() == {"status": "ok"} for response in responses)

        async with session_factory() as db:
            assert (
                await db.scalar(
                    select(func.count(IdentityActionToken.id)).where(
                        IdentityActionToken.user_id.in_(
                            (account_ids["suspended"], account_ids["unverified"])
                        ),
                        IdentityActionToken.purpose == "password_recovery",
                    )
                )
                == 0
            )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_password_recovery_cannot_bypass_or_replay_mfa() -> None:
    origin = "http://test"
    email = f"recovery-mfa-{uuid4()}@example.com"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.230", 54100)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "MFA browser",
            },
        )
        assert registered.status_code == 201
        user_id = UUID(registered.json()["user"]["id"])
        security = get_security()
        recovery_code = security.new_recovery_code()
        encrypted = TotpSecretCipher(get_settings()).encrypt(
            user_id,
            "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
        )
        now = datetime.now(UTC)
        async with session_factory() as db:
            db.add_all(
                (
                    TotpCredential(
                        user_id=user_id,
                        secret_ciphertext=encrypted.secret_ciphertext,
                        secret_nonce=encrypted.secret_nonce,
                        data_key_ciphertext=encrypted.data_key_ciphertext,
                        data_key_nonce=encrypted.data_key_nonce,
                        encryption_key_id=encrypted.encryption_key_id,
                        pending_expires_at=now,
                        verified_at=now,
                    ),
                    RecoveryCode(
                        user_id=user_id,
                        batch_id=uuid4(),
                        lookup_hash=security.recovery_code_lookup_hash(recovery_code),
                        code_hash=security.hash_recovery_code(recovery_code),
                    ),
                )
            )
            await db.commit()

        requested = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested.status_code == 202
        action, outbox, token = await _latest_recovery(user_id)
        for _ in range(get_settings().password_recovery_max_failures):
            denied = await client.post(
                "/api/v1/auth/password-recovery/completions",
                json={"token": token, "new_password": "replacement-password-123"},
            )
            assert denied.status_code == 400
            assert denied.json()["code"] == "AUTH_PASSWORD_RECOVERY_INVALID"

        async with session_factory() as db:
            terminal_action = await db.get(IdentityActionToken, action.id)
            terminal_outbox = await db.get(EmailOutbox, outbox.id)
            assert terminal_action is not None
            assert terminal_action.failed_attempts == get_settings().password_recovery_max_failures
            assert terminal_action.revoked_at is not None
            assert terminal_outbox is not None and terminal_outbox.status == "dead"
            failure_notification = await db.scalar(
                select(EmailOutbox)
                .where(
                    EmailOutbox.user_id == user_id,
                    EmailOutbox.purpose == "security_notification",
                )
                .order_by(EmailOutbox.created_at.desc(), EmailOutbox.id.desc())
            )
            assert failure_notification is not None
            assert EmailDeliveryCipher(get_settings()).decrypt(failure_notification) == {
                "event": "password_recovery_attempts_exhausted",
                "recipient": email,
            }
            serialized_audit = repr(
                [
                    event.event_metadata
                    for event in (
                        await db.scalars(
                            select(AuditEvent).where(AuditEvent.target_id == action.id)
                        )
                    ).all()
                ]
            )
            assert token not in serialized_audit
            assert recovery_code not in serialized_audit

        requested_again = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested_again.status_code == 202
        _, _, next_token = await _latest_recovery(user_id)
        completed = await client.post(
            "/api/v1/auth/password-recovery/completions",
            json={
                "token": next_token,
                "new_password": "replacement-password-123",
                "method": "recovery_code",
                "code": recovery_code,
            },
        )
        assert completed.status_code == 200, completed.text

        requested_third = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested_third.status_code == 202
        _, _, third_token = await _latest_recovery(user_id)
        reused = await client.post(
            "/api/v1/auth/password-recovery/completions",
            json={
                "token": third_token,
                "new_password": "third-password-123",
                "method": "recovery_code",
                "code": recovery_code,
            },
        )
        assert reused.status_code == 400


@pytest.mark.integration
@pytest.mark.asyncio
async def test_password_recovery_accepts_fresh_totp_and_rejects_replay() -> None:
    origin = "http://test"
    email = f"recovery-totp-{uuid4()}@example.com"
    totp_seed = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.228", 54098)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "TOTP recovery browser",
            },
        )
        assert registered.status_code == 201
        user_id = UUID(registered.json()["user"]["id"])
        encrypted = TotpSecretCipher(get_settings()).encrypt(user_id, totp_seed)
        now = datetime.now(UTC)
        async with session_factory() as db:
            db.add(
                TotpCredential(
                    user_id=user_id,
                    secret_ciphertext=encrypted.secret_ciphertext,
                    secret_nonce=encrypted.secret_nonce,
                    data_key_ciphertext=encrypted.data_key_ciphertext,
                    data_key_nonce=encrypted.data_key_nonce,
                    encryption_key_id=encrypted.encryption_key_id,
                    pending_expires_at=now,
                    verified_at=now,
                )
            )
            await db.commit()

        requested = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested.status_code == 202
        _, _, token = await _latest_recovery(user_id)
        code = pyotp.TOTP(totp_seed).now()
        completed = await client.post(
            "/api/v1/auth/password-recovery/completions",
            json={
                "token": token,
                "new_password": "replacement-password-123",
                "method": "totp",
                "code": code,
            },
        )
        assert completed.status_code == 200

        requested_again = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested_again.status_code == 202
        action, _, next_token = await _latest_recovery(user_id)
        replayed = await client.post(
            "/api/v1/auth/password-recovery/completions",
            json={
                "token": next_token,
                "new_password": "third-password-123",
                "method": "totp",
                "code": code,
            },
        )
        assert replayed.status_code == 400
        async with session_factory() as db:
            stored_action = await db.get(IdentityActionToken, action.id)
            assert stored_action is not None and stored_action.failed_attempts == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_expired_password_recovery_is_terminal_and_clears_payload() -> None:
    origin = "http://test"
    email = f"recovery-expired-{uuid4()}@example.com"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.231", 54101)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "Expiry browser",
            },
        )
        assert registered.status_code == 201
        user_id = UUID(registered.json()["user"]["id"])
        requested = await client.post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested.status_code == 202
        action, outbox, token = await _latest_recovery(user_id)
        async with session_factory() as db:
            stored_action = await db.get(IdentityActionToken, action.id)
            assert stored_action is not None
            stored_action.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()

        denied = await client.post(
            "/api/v1/auth/password-recovery/completions",
            json={"token": token, "new_password": "replacement-password-123"},
        )
        assert denied.status_code == 400
        assert denied.json()["code"] == "AUTH_PASSWORD_RECOVERY_INVALID"
        async with session_factory() as db:
            terminal_action = await db.get(IdentityActionToken, action.id)
            terminal_outbox = await db.get(EmailOutbox, outbox.id)
            assert terminal_action is not None and terminal_action.revoked_at is not None
            assert terminal_outbox is not None
            assert terminal_outbox.status == "dead"
            assert terminal_outbox.payload_ciphertext == b""
            assert terminal_outbox.payload_nonce == b""


@pytest.mark.integration
@pytest.mark.asyncio
async def test_concurrent_password_recovery_completion_has_one_winner() -> None:
    origin = "http://test"
    email = f"recovery-concurrent-{uuid4()}@example.com"
    clients = [
        AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{232 + index}", 54200 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index in range(2)
    ]
    try:
        registered = await clients[0].post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "original-password-123",
                "device_name": "Concurrent browser",
            },
        )
        assert registered.status_code == 201
        user_id = UUID(registered.json()["user"]["id"])
        requested = await clients[0].post(
            "/api/v1/auth/password-recovery/requests",
            json={"email": email},
        )
        assert requested.status_code == 202
        action, _, token = await _latest_recovery(user_id)

        responses = await asyncio.gather(
            *(
                client.post(
                    "/api/v1/auth/password-recovery/completions",
                    json={"token": token, "new_password": "replacement-password-123"},
                )
                for client in clients
            )
        )
        assert sorted(response.status_code for response in responses) == [200, 400]
        denied = next(response for response in responses if response.status_code == 400)
        assert denied.json()["code"] == "AUTH_PASSWORD_RECOVERY_INVALID"

        async with session_factory() as db:
            stored_action = await db.get(IdentityActionToken, action.id)
            assert stored_action is not None and stored_action.used_at is not None
            assert (
                await db.scalar(
                    select(func.count(EmailOutbox.id)).where(
                        EmailOutbox.user_id == user_id,
                        EmailOutbox.purpose == "security_notification",
                    )
                )
                == 1
            )
    finally:
        for client in clients:
            await client.aclose()
