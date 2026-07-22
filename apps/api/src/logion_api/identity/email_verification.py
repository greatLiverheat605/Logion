import base64
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import (
    AuthSession,
    EmailOutbox,
    IdentityActionToken,
    PasswordCredential,
    RefreshToken,
    User,
)
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import normalize_email
from logion_api.identity.totp import TotpService


@dataclass(frozen=True)
class EncryptedEmailPayload:
    ciphertext: bytes
    nonce: bytes
    key_id: str


class EmailDeliveryCipher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def encrypt(
        self,
        *,
        outbox_id: UUID,
        user_id: UUID,
        purpose: str,
        payload: dict[str, str],
    ) -> EncryptedEmailPayload:
        key_id = self._settings.email_delivery_active_encryption_key_id
        key = self._decode_key(key_id)
        nonce = secrets.token_bytes(12)
        plaintext = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
        ciphertext = AESGCM(key).encrypt(
            nonce,
            plaintext,
            self._aad(outbox_id, user_id, purpose, key_id),
        )
        return EncryptedEmailPayload(ciphertext=ciphertext, nonce=nonce, key_id=key_id)

    def decrypt(self, outbox: EmailOutbox) -> dict[str, str]:
        try:
            key = self._decode_key(outbox.encryption_key_id)
            plaintext = AESGCM(key).decrypt(
                outbox.payload_nonce,
                outbox.payload_ciphertext,
                self._aad(
                    outbox.id,
                    outbox.user_id,
                    outbox.purpose,
                    outbox.encryption_key_id,
                ),
            )
            values: Any = json.loads(plaintext)
            if not isinstance(values, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in values.items()
            ):
                raise ValueError
            return values
        except (InvalidTag, UnicodeDecodeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise APIError(
                code="AUTH_EMAIL_DELIVERY_KEY_UNAVAILABLE",
                message="Email delivery is temporarily unavailable.",
                status_code=503,
                retryable=True,
            ) from exc

    def _decode_key(self, key_id: str) -> bytes:
        encoded = self._settings.email_delivery_encryption_keys[key_id].get_secret_value()
        return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))

    @staticmethod
    def _aad(outbox_id: UUID, user_id: UUID, purpose: str, key_id: str) -> bytes:
        return f"logion:email-outbox:v1:{outbox_id}:{user_id}:{purpose}:{key_id}".encode()


class EmailVerificationService:
    _PURPOSE = "email_verification"
    _RECOVERY_PURPOSE = "password_recovery"

    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security
        self._cipher = EmailDeliveryCipher(settings)

    async def start_registration(
        self,
        db: AsyncSession,
        email: str,
        *,
        request_id: str,
    ) -> None:
        normalized = normalize_email(email)
        user = await db.scalar(
            select(User).where(User.email_normalized == normalized).with_for_update()
        )
        if user is not None and (user.email_verified_at is not None or user.status != "active"):
            self._security.privacy_hash(normalized)
            return
        if user is None:
            try:
                async with db.begin_nested():
                    candidate = User(email=email, email_normalized=normalized)
                    db.add(candidate)
                    await db.flush()
                user = candidate
            except IntegrityError:
                user = await db.scalar(
                    select(User).where(User.email_normalized == normalized).with_for_update()
                )
                if user is None:
                    raise

        now = datetime.now(UTC)
        active_token_ids = select(IdentityActionToken.id).where(
            IdentityActionToken.user_id == user.id,
            IdentityActionToken.purpose == self._PURPOSE,
            IdentityActionToken.used_at.is_(None),
            IdentityActionToken.revoked_at.is_(None),
        )
        await db.execute(
            update(EmailOutbox)
            .where(
                EmailOutbox.action_token_id.in_(active_token_ids),
                EmailOutbox.status.in_(("pending", "leased")),
            )
            .values(
                status="dead",
                payload_ciphertext=b"",
                payload_nonce=b"",
                terminal_at=now,
            )
        )
        await db.execute(
            update(IdentityActionToken)
            .where(
                IdentityActionToken.user_id == user.id,
                IdentityActionToken.purpose == self._PURPOSE,
                IdentityActionToken.used_at.is_(None),
                IdentityActionToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        raw_token = self._security.new_identity_action_token()
        action = IdentityActionToken(
            id=uuid7(),
            user_id=user.id,
            purpose=self._PURPOSE,
            token_hash=self._security.identity_action_token_hash(self._PURPOSE, raw_token),
            expires_at=now + timedelta(hours=self._settings.email_verification_ttl_hours),
        )
        outbox_id = uuid7()
        encrypted = self._cipher.encrypt(
            outbox_id=outbox_id,
            user_id=user.id,
            purpose=self._PURPOSE,
            payload={"recipient": user.email, "token": raw_token},
        )
        db.add(action)
        await db.flush()
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=user.id,
                action_token_id=action.id,
                purpose=self._PURPOSE,
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.email_verification_requested",
                result="pending",
                target_type="user",
                target_id=user.id,
                metadata={"email_hash": self._security.privacy_hash(normalized)},
            )
        )

    async def confirm(
        self,
        db: AsyncSession,
        raw_token: str,
        password: str,
        *,
        request_id: str,
    ) -> User:
        now = datetime.now(UTC)
        action = await db.scalar(
            select(IdentityActionToken)
            .where(
                IdentityActionToken.token_hash
                == self._security.identity_action_token_hash(self._PURPOSE, raw_token)
            )
            .with_for_update()
        )
        if (
            action is None
            or action.purpose != self._PURPOSE
            or action.used_at is not None
            or action.revoked_at is not None
            or action.expires_at <= now
        ):
            raise self._invalid_token()
        user = await db.scalar(select(User).where(User.id == action.user_id).with_for_update())
        if user is None or user.status != "active":
            raise self._invalid_token()

        credential = await db.scalar(
            select(PasswordCredential)
            .where(PasswordCredential.user_id == user.id)
            .with_for_update()
        )
        password_hash = self._security.hash_password(password)
        if credential is None:
            db.add(PasswordCredential(user_id=user.id, password_hash=password_hash))
        else:
            credential.password_hash = password_hash
            credential.updated_at = now
        user.email_verified_at = user.email_verified_at or now
        user.updated_at = now
        user.version += 1
        action.used_at = now
        await db.execute(
            update(IdentityActionToken)
            .where(
                IdentityActionToken.user_id == user.id,
                IdentityActionToken.purpose == self._PURPOSE,
                IdentityActionToken.id != action.id,
                IdentityActionToken.used_at.is_(None),
                IdentityActionToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await db.execute(
            update(EmailOutbox)
            .where(
                EmailOutbox.action_token_id == action.id,
                EmailOutbox.status.in_(("pending", "leased")),
            )
            .values(
                status="dead",
                payload_ciphertext=b"",
                payload_nonce=b"",
                terminal_at=now,
            )
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.email_verified",
                result="success",
                actor_id=user.id,
                target_type="user",
                target_id=user.id,
            )
        )
        return user

    async def start_password_recovery(
        self,
        db: AsyncSession,
        email: str,
        *,
        request_id: str,
    ) -> None:
        normalized = normalize_email(email)
        result = await db.execute(
            select(User, PasswordCredential)
            .join(PasswordCredential, PasswordCredential.user_id == User.id)
            .where(User.email_normalized == normalized)
            .with_for_update(of=User)
        )
        row = result.one_or_none()
        if row is None:
            self._security.privacy_hash(normalized)
            return
        user: User = row[0]
        if user.status != "active" or user.email_verified_at is None:
            self._security.privacy_hash(normalized)
            return

        now = datetime.now(UTC)
        await self._terminate_active_actions(db, user.id, self._RECOVERY_PURPOSE, now)
        raw_token = self._security.new_identity_action_token()
        action = IdentityActionToken(
            id=uuid7(),
            user_id=user.id,
            purpose=self._RECOVERY_PURPOSE,
            token_hash=self._security.identity_action_token_hash(
                self._RECOVERY_PURPOSE,
                raw_token,
            ),
            expires_at=now + timedelta(minutes=self._settings.password_recovery_ttl_minutes),
        )
        db.add(action)
        await db.flush()
        await self._add_outbox(
            db,
            user=user,
            action_token_id=action.id,
            purpose=self._RECOVERY_PURPOSE,
            payload={"recipient": user.email, "token": raw_token},
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.password_recovery_requested",
                result="pending",
                target_type="user",
                target_id=user.id,
                metadata={"email_hash": self._security.privacy_hash(normalized)},
            )
        )

    async def complete_password_recovery(
        self,
        db: AsyncSession,
        totp: TotpService,
        raw_token: str,
        new_password: str,
        method: str | None,
        code: str | None,
        *,
        request_id: str,
    ) -> User:
        now = datetime.now(UTC)
        candidate = await db.scalar(
            select(IdentityActionToken)
            .where(
                IdentityActionToken.token_hash
                == self._security.identity_action_token_hash(
                    self._RECOVERY_PURPOSE,
                    raw_token,
                )
            )
        )
        if candidate is None or candidate.purpose != self._RECOVERY_PURPOSE:
            raise self._invalid_recovery()

        # Keep the lock order consistent with recovery start: user, then action.
        # Re-read and validate the action after both locks are held so a concurrent
        # replacement cannot consume a superseded token.
        user = await db.scalar(
            select(User).where(User.id == candidate.user_id).with_for_update()
        )
        action = await db.scalar(
            select(IdentityActionToken)
            .where(IdentityActionToken.id == candidate.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (
            action is None
            or action.purpose != self._RECOVERY_PURPOSE
            or action.used_at is not None
            or action.revoked_at is not None
            or action.failed_attempts >= self._settings.password_recovery_max_failures
        ):
            raise self._invalid_recovery()
        if action.expires_at <= now:
            action.revoked_at = now
            await self._terminate_outbox_for_action(db, action.id, now)
            raise self._invalid_recovery()
        if user is None or user.status != "active" or user.email_verified_at is None:
            raise self._invalid_recovery()

        try:
            mfa_method = await totp.verify_password_recovery_factor(
                db,
                user.id,
                method,
                code,
                now=now,
            )
        except APIError as exc:
            if exc.status_code == 503:
                raise
            action.failed_attempts += 1
            if action.failed_attempts >= self._settings.password_recovery_max_failures:
                action.revoked_at = now
                await self._terminate_outbox_for_action(db, action.id, now)
                await self._add_outbox(
                    db,
                    user=user,
                    action_token_id=None,
                    purpose="security_notification",
                    payload={
                        "recipient": user.email,
                        "event": "password_recovery_attempts_exhausted",
                    },
                )
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.password_recovery_failed",
                    result="denied",
                    actor_id=user.id,
                    target_type="identity_action_token",
                    target_id=action.id,
                    metadata={"method": method or "missing"},
                )
            )
            raise self._invalid_recovery() from exc

        credential = await db.scalar(
            select(PasswordCredential)
            .where(PasswordCredential.user_id == user.id)
            .with_for_update()
        )
        if credential is None:
            raise self._invalid_recovery()
        credential.password_hash = self._security.hash_password(new_password)
        credential.updated_at = now
        user.updated_at = now
        user.version += 1
        action.used_at = now
        await self._terminate_outbox_for_action(db, action.id, now)

        session_ids = select(AuthSession.id).where(AuthSession.user_id == user.id)
        await db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.session_id.in_(session_ids),
                RefreshToken.status == "active",
            )
            .values(status="revoked", used_at=now)
        )
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason="password_recovery")
        )
        await self._add_outbox(
            db,
            user=user,
            action_token_id=None,
            purpose="security_notification",
            payload={"recipient": user.email, "event": "password_recovery_completed"},
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.password_recovered",
                result="success",
                actor_id=user.id,
                target_type="user",
                target_id=user.id,
                metadata={"mfa_method": mfa_method or "not_required"},
            )
        )
        return user

    async def _terminate_active_actions(
        self,
        db: AsyncSession,
        user_id: UUID,
        purpose: str,
        now: datetime,
    ) -> None:
        active_ids = select(IdentityActionToken.id).where(
            IdentityActionToken.user_id == user_id,
            IdentityActionToken.purpose == purpose,
            IdentityActionToken.used_at.is_(None),
            IdentityActionToken.revoked_at.is_(None),
        )
        await db.execute(
            update(EmailOutbox)
            .where(
                EmailOutbox.action_token_id.in_(active_ids),
                EmailOutbox.status.in_(("pending", "leased")),
            )
            .values(
                status="dead",
                payload_ciphertext=b"",
                payload_nonce=b"",
                terminal_at=now,
            )
        )
        await db.execute(
            update(IdentityActionToken)
            .where(IdentityActionToken.id.in_(active_ids))
            .values(revoked_at=now)
        )

    async def _terminate_outbox_for_action(
        self,
        db: AsyncSession,
        action_token_id: UUID,
        now: datetime,
    ) -> None:
        await db.execute(
            update(EmailOutbox)
            .where(
                EmailOutbox.action_token_id == action_token_id,
                EmailOutbox.status.in_(("pending", "leased")),
            )
            .values(
                status="dead",
                payload_ciphertext=b"",
                payload_nonce=b"",
                terminal_at=now,
            )
        )

    async def _add_outbox(
        self,
        db: AsyncSession,
        *,
        user: User,
        action_token_id: UUID | None,
        purpose: str,
        payload: dict[str, str],
    ) -> EmailOutbox:
        outbox_id = uuid7()
        encrypted = self._cipher.encrypt(
            outbox_id=outbox_id,
            user_id=user.id,
            purpose=purpose,
            payload=payload,
        )
        outbox = EmailOutbox(
            id=outbox_id,
            user_id=user.id,
            action_token_id=action_token_id,
            purpose=purpose,
            encryption_key_id=encrypted.key_id,
            payload_ciphertext=encrypted.ciphertext,
            payload_nonce=encrypted.nonce,
        )
        db.add(outbox)
        return outbox

    @staticmethod
    def _invalid_token() -> APIError:
        return APIError(
            code="AUTH_EMAIL_ACTION_INVALID",
            message="The email action is invalid or has expired.",
            status_code=400,
        )

    @staticmethod
    def _invalid_recovery() -> APIError:
        return APIError(
            code="AUTH_PASSWORD_RECOVERY_INVALID",
            message="The password recovery request is invalid or has expired.",
            status_code=400,
        )
