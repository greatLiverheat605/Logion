import asyncio
from collections.abc import AsyncIterator
from datetime import timedelta
from uuid import uuid4

import pytest
from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import EmailOutbox, IdentityActionToken, User
from logion_worker.email_delivery import (
    DeliveryReceipt,
    EmailDeliveryFailure,
    EmailDeliveryService,
    EmailMessage,
)
from sqlalchemy import delete


@pytest.fixture(autouse=True)
async def isolate_email_queue() -> AsyncIterator[None]:
    async with session_factory() as db:
        await db.execute(delete(EmailOutbox))
        await db.commit()
    yield
    async with session_factory() as db:
        await db.execute(delete(EmailOutbox))
        await db.commit()


class RecordingTransport:
    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []

    async def send(self, message: EmailMessage) -> DeliveryReceipt:
        self.messages.append(message)
        return DeliveryReceipt("env-integration", "request-integration")


class FailingTransport:
    async def send(self, _message: EmailMessage) -> DeliveryReceipt:
        raise EmailDeliveryFailure("EMAIL_PROVIDER_UNAVAILABLE", retryable=True)


class DelayedRecordingTransport(RecordingTransport):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def send(self, message: EmailMessage) -> DeliveryReceipt:
        self.messages.append(message)
        self.started.set()
        await self.release.wait()
        return DeliveryReceipt("env-integration", "request-integration")


def integration_settings() -> Settings:
    return Settings(
        allowed_origins=["http://test"],
        webauthn_rp_id="test",
        webauthn_origins=["http://test"],
        email_delivery_provider="aliyun_directmail",
        email_public_base_url="http://test",
        aliyun_directmail_account_name="no-reply@mail.example.com",
        aliyun_directmail_ram_role_name="LogionDirectMailSender",
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_worker_delivers_active_token_and_clears_encrypted_payload(
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = integration_settings()
    transport = RecordingTransport()
    user_id = uuid4()
    action_id = uuid4()
    outbox_id = uuid4()
    email = f"worker-mail-{uuid4()}@example.com"
    token = f"secret-token-{uuid4()}"
    encrypted = EmailDeliveryCipher(settings).encrypt(
        outbox_id=outbox_id,
        user_id=user_id,
        purpose="email_verification",
        payload={"recipient": email, "token": token},
    )
    async with session_factory() as db:
        db.add(User(id=user_id, email=email, email_normalized=email.casefold()))
        await db.flush()
        db.add(
            IdentityActionToken(
                id=action_id,
                user_id=user_id,
                purpose="email_verification",
                token_hash=uuid4().hex + uuid4().hex,
                expires_at=utc_now() + timedelta(hours=1),
            )
        )
        await db.flush()
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=user_id,
                action_token_id=action_id,
                purpose="email_verification",
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )
        await db.commit()

    try:
        assert await EmailDeliveryService(settings, transport).execute_next() is True

        assert len(transport.messages) == 1
        assert f"http://test/auth/verify#{token}" in transport.messages[0].text_body
        async with session_factory() as db:
            row = await db.get(EmailOutbox, outbox_id)
            assert row is not None
            assert row.status == "sent"
            assert row.attempts == 1
            assert row.sent_at is not None
            assert row.payload_ciphertext == b""
            assert row.payload_nonce == b""

        logs = capsys.readouterr().out
        assert "email_delivery_succeeded" in logs
        assert email not in logs
        assert token not in logs
    finally:
        async with session_factory() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_worker_discards_expired_action_without_sending() -> None:
    settings = integration_settings()
    transport = RecordingTransport()
    user_id = uuid4()
    action_id = uuid4()
    outbox_id = uuid4()
    email = f"worker-expired-{uuid4()}@example.com"
    encrypted = EmailDeliveryCipher(settings).encrypt(
        outbox_id=outbox_id,
        user_id=user_id,
        purpose="password_recovery",
        payload={"recipient": email, "token": f"expired-{uuid4()}"},
    )
    async with session_factory() as db:
        db.add(User(id=user_id, email=email, email_normalized=email.casefold()))
        await db.flush()
        db.add(
            IdentityActionToken(
                id=action_id,
                user_id=user_id,
                purpose="password_recovery",
                token_hash=uuid4().hex + uuid4().hex,
                expires_at=utc_now() - timedelta(seconds=1),
            )
        )
        await db.flush()
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=user_id,
                action_token_id=action_id,
                purpose="password_recovery",
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )
        await db.commit()

    try:
        assert await EmailDeliveryService(settings, transport).execute_next() is True
        assert transport.messages == []
        async with session_factory() as db:
            row = await db.get(EmailOutbox, outbox_id)
            assert row is not None
            assert row.status == "dead"
            assert row.payload_ciphertext == b""
            assert row.payload_nonce == b""
    finally:
        async with session_factory() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_worker_retries_then_fails_without_leaking_payload(
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = integration_settings().model_copy(update={"email_delivery_max_attempts": 2})
    user_id = uuid4()
    action_id = uuid4()
    outbox_id = uuid4()
    email = f"worker-retry-{uuid4()}@example.com"
    token = f"retry-token-{uuid4()}"
    encrypted = EmailDeliveryCipher(settings).encrypt(
        outbox_id=outbox_id,
        user_id=user_id,
        purpose="email_verification",
        payload={"recipient": email, "token": token},
    )
    async with session_factory() as db:
        db.add(User(id=user_id, email=email, email_normalized=email.casefold()))
        await db.flush()
        db.add(
            IdentityActionToken(
                id=action_id,
                user_id=user_id,
                purpose="email_verification",
                token_hash=uuid4().hex + uuid4().hex,
                expires_at=utc_now() + timedelta(hours=1),
            )
        )
        await db.flush()
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=user_id,
                action_token_id=action_id,
                purpose="email_verification",
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )
        await db.commit()

    service = EmailDeliveryService(settings, FailingTransport())
    try:
        assert await service.execute_next() is True
        async with session_factory() as db:
            row = await db.get(EmailOutbox, outbox_id)
            assert row is not None
            assert row.status == "pending"
            assert row.attempts == 1
            assert row.payload_ciphertext != b""
            row.available_at = utc_now() - timedelta(seconds=1)
            await db.commit()

        assert await service.execute_next() is True
        async with session_factory() as db:
            row = await db.get(EmailOutbox, outbox_id)
            assert row is not None
            assert row.status == "failed"
            assert row.attempts == 2
            assert row.payload_ciphertext == b""
            assert row.payload_nonce == b""

        logs = capsys.readouterr().out
        assert "EMAIL_PROVIDER_UNAVAILABLE" in logs
        assert email not in logs
        assert token not in logs
    finally:
        async with session_factory() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_worker_does_not_lease_the_same_message_twice() -> None:
    settings = integration_settings()
    transport = DelayedRecordingTransport()
    user_id = uuid4()
    action_id = uuid4()
    outbox_id = uuid4()
    email = f"worker-concurrent-{uuid4()}@example.com"
    encrypted = EmailDeliveryCipher(settings).encrypt(
        outbox_id=outbox_id,
        user_id=user_id,
        purpose="email_verification",
        payload={"recipient": email, "token": f"concurrent-{uuid4()}"},
    )
    async with session_factory() as db:
        db.add(User(id=user_id, email=email, email_normalized=email.casefold()))
        await db.flush()
        db.add(
            IdentityActionToken(
                id=action_id,
                user_id=user_id,
                purpose="email_verification",
                token_hash=uuid4().hex + uuid4().hex,
                expires_at=utc_now() + timedelta(hours=1),
            )
        )
        await db.flush()
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=user_id,
                action_token_id=action_id,
                purpose="email_verification",
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )
        await db.commit()

    first = asyncio.create_task(EmailDeliveryService(settings, transport).execute_next())
    try:
        await asyncio.wait_for(transport.started.wait(), timeout=5)
        assert await EmailDeliveryService(settings, transport).execute_next() is False
        transport.release.set()
        assert await first is True
        assert len(transport.messages) == 1
    finally:
        transport.release.set()
        await first
        async with session_factory() as db:
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()
