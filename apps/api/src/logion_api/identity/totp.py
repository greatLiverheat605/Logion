import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

import pyotp
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import (
    AuditEvent,
    MfaChallenge,
    RecoveryCode,
    TotpCredential,
    User,
)
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, require_verified_email


@dataclass(frozen=True)
class EncryptedTotpSecret:
    secret_ciphertext: bytes
    secret_nonce: bytes
    data_key_ciphertext: bytes
    data_key_nonce: bytes
    encryption_key_id: str


@dataclass(frozen=True)
class TotpEnrollment:
    secret: str
    provisioning_uri: str
    expires_at: datetime


@dataclass(frozen=True)
class TotpActivation:
    recovery_codes: list[str]
    verified_at: datetime


@dataclass(frozen=True)
class VerifiedMfa:
    user: User
    challenge: MfaChallenge
    method: str


class TotpSecretCipher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def encrypt(self, user_id: UUID, secret: str) -> EncryptedTotpSecret:
        key_id = self._settings.totp_active_encryption_key_id
        key = self._decode_key(key_id)
        data_key = AESGCM.generate_key(bit_length=256)
        secret_nonce = secrets.token_bytes(12)
        data_key_nonce = secrets.token_bytes(12)
        secret_ciphertext = AESGCM(data_key).encrypt(
            secret_nonce,
            secret.encode("ascii"),
            self._secret_aad(user_id),
        )
        data_key_ciphertext = AESGCM(key).encrypt(
            data_key_nonce,
            data_key,
            self._data_key_aad(user_id, key_id),
        )
        return EncryptedTotpSecret(
            secret_ciphertext=secret_ciphertext,
            secret_nonce=secret_nonce,
            data_key_ciphertext=data_key_ciphertext,
            data_key_nonce=data_key_nonce,
            encryption_key_id=key_id,
        )

    def decrypt(self, credential: TotpCredential) -> str:
        try:
            key = self._decode_key(credential.encryption_key_id)
            data_key = AESGCM(key).decrypt(
                credential.data_key_nonce,
                credential.data_key_ciphertext,
                self._data_key_aad(credential.user_id, credential.encryption_key_id),
            )
            plaintext = AESGCM(data_key).decrypt(
                credential.secret_nonce,
                credential.secret_ciphertext,
                self._secret_aad(credential.user_id),
            )
            return plaintext.decode("ascii")
        except (InvalidTag, UnicodeDecodeError, ValueError, KeyError) as exc:
            raise APIError(
                code="AUTH_TOTP_KEY_UNAVAILABLE",
                message="TOTP verification is temporarily unavailable.",
                status_code=503,
                retryable=True,
            ) from exc

    def _decode_key(self, key_id: str) -> bytes:
        encoded = self._settings.totp_encryption_keys[key_id].get_secret_value()
        return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))

    @staticmethod
    def _secret_aad(user_id: UUID) -> bytes:
        return f"logion:totp-secret:v1:{user_id}".encode()

    @staticmethod
    def _data_key_aad(user_id: UUID, key_id: str) -> bytes:
        return f"logion:totp-data-key:v1:{user_id}:{key_id}".encode()


class TotpService:
    _RECOVERY_CODE_COUNT = 10
    _MAX_CHALLENGE_FAILURES = 5

    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security
        self._cipher = TotpSecretCipher(settings)

    async def start_enrollment(
        self,
        db: AsyncSession,
        context: AuthContext,
        *,
        request_id: str,
    ) -> TotpEnrollment:
        require_verified_email(context.user)
        credential = await db.scalar(
            select(TotpCredential)
            .where(TotpCredential.user_id == context.user.id)
            .with_for_update()
        )
        if credential is not None and credential.verified_at is not None:
            raise APIError(
                code="AUTH_TOTP_ALREADY_ENABLED",
                message="TOTP is already enabled for this account.",
                status_code=409,
            )

        secret = pyotp.random_base32(length=32)
        encrypted = self._cipher.encrypt(context.user.id, secret)
        expires_at = datetime.now(UTC) + timedelta(
            seconds=self._settings.totp_enrollment_ttl_seconds
        )
        if credential is None:
            credential = TotpCredential(
                user_id=context.user.id,
                secret_ciphertext=encrypted.secret_ciphertext,
                secret_nonce=encrypted.secret_nonce,
                data_key_ciphertext=encrypted.data_key_ciphertext,
                data_key_nonce=encrypted.data_key_nonce,
                encryption_key_id=encrypted.encryption_key_id,
                algorithm="SHA1",
                digits=6,
                period=30,
                pending_expires_at=expires_at,
            )
            db.add(credential)
        else:
            credential.secret_ciphertext = encrypted.secret_ciphertext
            credential.secret_nonce = encrypted.secret_nonce
            credential.data_key_ciphertext = encrypted.data_key_ciphertext
            credential.data_key_nonce = encrypted.data_key_nonce
            credential.encryption_key_id = encrypted.encryption_key_id
            credential.pending_expires_at = expires_at
            credential.last_used_step = None
            credential.updated_at = datetime.now(UTC)

        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.totp_enrollment_started",
                result="pending",
                actor_id=context.user.id,
                target_type="totp_credential",
                target_id=context.user.id,
            )
        )
        totp = pyotp.TOTP(secret, digits=credential.digits, interval=credential.period)
        return TotpEnrollment(
            secret=secret,
            provisioning_uri=totp.provisioning_uri(
                name=context.user.email,
                issuer_name=self._settings.totp_issuer_name,
            ),
            expires_at=expires_at,
        )

    async def activate(
        self,
        db: AsyncSession,
        context: AuthContext,
        code: str,
        *,
        request_id: str,
        now: datetime | None = None,
    ) -> TotpActivation:
        require_verified_email(context.user)
        current_time = now or datetime.now(UTC)
        credential = await self._credential_for_update(db, context.user.id)
        if credential is None or credential.verified_at is not None:
            raise self._enrollment_error()
        if credential.pending_expires_at <= current_time:
            raise self._enrollment_error()
        step = self._match_totp_step(credential, code, current_time)
        if step is None:
            db.add(self._failed_audit(request_id, context.user.id, "enrollment"))
            raise self._invalid_code_error()

        credential.verified_at = current_time
        credential.last_used_step = step
        credential.updated_at = current_time
        recovery_codes = await self._replace_recovery_codes(db, context.user.id, current_time)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.totp_enabled",
                result="success",
                actor_id=context.user.id,
                target_type="totp_credential",
                target_id=context.user.id,
                metadata={"recovery_code_count": len(recovery_codes)},
            )
        )
        return TotpActivation(recovery_codes=recovery_codes, verified_at=current_time)

    async def verify_login(
        self,
        db: AsyncSession,
        challenge_token: str,
        code: str,
        method: str,
        *,
        request_id: str,
        now: datetime | None = None,
    ) -> VerifiedMfa:
        current_time = now or datetime.now(UTC)
        result = await db.execute(
            select(MfaChallenge, User)
            .join(User, User.id == MfaChallenge.user_id)
            .where(MfaChallenge.token_hash == self._security.token_hash(challenge_token))
            .with_for_update()
        )
        row = result.one_or_none()
        if row is None:
            raise self._challenge_error()
        challenge, user = row
        if (
            challenge.used_at is not None
            or challenge.expires_at <= current_time
            or challenge.failed_attempts >= self._MAX_CHALLENGE_FAILURES
            or user.status != "active"
        ):
            raise self._challenge_error()

        verified = False
        if method == "totp":
            credential = await self._credential_for_update(db, user.id)
            if credential is not None and credential.verified_at is not None:
                step = self._match_totp_step(credential, code, current_time)
                if step is not None and (
                    credential.last_used_step is None or step > credential.last_used_step
                ):
                    credential.last_used_step = step
                    credential.updated_at = current_time
                    verified = True
        elif method == "recovery_code":
            verified = await self._consume_recovery_code(db, user.id, code, current_time)

        if not verified:
            challenge.failed_attempts += 1
            if challenge.failed_attempts >= self._MAX_CHALLENGE_FAILURES:
                challenge.used_at = current_time
            db.add(self._failed_audit(request_id, user.id, method))
            raise self._invalid_code_error()

        challenge.used_at = current_time
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.mfa_login_verified",
                result="success",
                actor_id=user.id,
                target_type="mfa_challenge",
                target_id=challenge.id,
                metadata={"method": method},
            )
        )
        return VerifiedMfa(user=user, challenge=challenge, method=method)

    async def status(self, db: AsyncSession, context: AuthContext) -> tuple[bool, int]:
        enabled = (
            await db.scalar(
                select(TotpCredential.user_id).where(
                    TotpCredential.user_id == context.user.id,
                    TotpCredential.verified_at.is_not(None),
                )
            )
            is not None
        )
        remaining = 0
        if enabled:
            remaining = int(
                await db.scalar(
                    select(func.count(RecoveryCode.id)).where(
                        RecoveryCode.user_id == context.user.id,
                        RecoveryCode.used_at.is_(None),
                        RecoveryCode.revoked_at.is_(None),
                    )
                )
                or 0
            )
        return enabled, remaining

    async def verify_password_recovery_factor(
        self,
        db: AsyncSession,
        user_id: UUID,
        method: str | None,
        code: str | None,
        *,
        now: datetime,
    ) -> str | None:
        credential = await self._credential_for_update(db, user_id)
        if credential is None or credential.verified_at is None:
            return None
        verified = False
        if method == "totp" and code is not None:
            step = self._match_totp_step(credential, code, now)
            if step is not None and (
                credential.last_used_step is None or step > credential.last_used_step
            ):
                credential.last_used_step = step
                credential.updated_at = now
                verified = True
        elif method == "recovery_code" and code is not None:
            verified = await self._consume_recovery_code(db, user_id, code, now)
        if not verified:
            raise self._invalid_code_error()
        return method

    async def regenerate_recovery_codes(
        self,
        db: AsyncSession,
        context: AuthContext,
        code: str,
        *,
        request_id: str,
        now: datetime | None = None,
    ) -> list[str]:
        current_time = now or datetime.now(UTC)
        try:
            credential = await self._active_credential_with_code(
                db,
                context.user.id,
                code,
                current_time,
            )
        except APIError:
            db.add(self._failed_audit(request_id, context.user.id, "recovery_regeneration"))
            raise
        credential.updated_at = current_time
        recovery_codes = await self._replace_recovery_codes(db, context.user.id, current_time)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.recovery_codes_regenerated",
                result="success",
                actor_id=context.user.id,
                target_type="totp_credential",
                target_id=context.user.id,
                metadata={"recovery_code_count": len(recovery_codes)},
            )
        )
        return recovery_codes

    async def disable(
        self,
        db: AsyncSession,
        context: AuthContext,
        code: str,
        *,
        request_id: str,
        now: datetime | None = None,
    ) -> None:
        current_time = now or datetime.now(UTC)
        try:
            credential = await self._active_credential_with_code(
                db,
                context.user.id,
                code,
                current_time,
            )
        except APIError:
            db.add(self._failed_audit(request_id, context.user.id, "disable"))
            raise
        await db.execute(
            update(RecoveryCode)
            .where(
                RecoveryCode.user_id == context.user.id,
                RecoveryCode.used_at.is_(None),
                RecoveryCode.revoked_at.is_(None),
            )
            .values(revoked_at=current_time)
        )
        await db.delete(credential)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.totp_disabled",
                result="success",
                actor_id=context.user.id,
                target_type="totp_credential",
                target_id=context.user.id,
            )
        )

    async def _active_credential_with_code(
        self,
        db: AsyncSession,
        user_id: UUID,
        code: str,
        now: datetime,
    ) -> TotpCredential:
        credential = await self._credential_for_update(db, user_id)
        if credential is None or credential.verified_at is None:
            raise APIError(
                code="AUTH_TOTP_NOT_ENABLED",
                message="TOTP is not enabled for this account.",
                status_code=409,
            )
        step = self._match_totp_step(credential, code, now)
        if step is None or (
            credential.last_used_step is not None and step <= credential.last_used_step
        ):
            raise self._invalid_code_error()
        credential.last_used_step = step
        return credential

    async def _credential_for_update(
        self,
        db: AsyncSession,
        user_id: UUID,
    ) -> TotpCredential | None:
        return cast(
            TotpCredential | None,
            await db.scalar(
                select(TotpCredential).where(TotpCredential.user_id == user_id).with_for_update()
            ),
        )

    def _match_totp_step(
        self,
        credential: TotpCredential,
        code: str,
        now: datetime,
    ) -> int | None:
        if len(code) != credential.digits or not code.isascii() or not code.isdigit():
            return None
        secret = self._cipher.decrypt(credential)
        totp = pyotp.TOTP(
            secret,
            digits=credential.digits,
            interval=credential.period,
            digest=hashlib.sha1,
        )
        current_step = int(now.timestamp()) // credential.period
        for offset in (-1, 0, 1):
            step = current_step + offset
            if self._security.constant_time_equal(totp.at(step * credential.period), code):
                return step
        return None

    async def _replace_recovery_codes(
        self,
        db: AsyncSession,
        user_id: UUID,
        now: datetime,
    ) -> list[str]:
        await db.execute(
            update(RecoveryCode)
            .where(
                RecoveryCode.user_id == user_id,
                RecoveryCode.used_at.is_(None),
                RecoveryCode.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        batch_id = uuid7()
        codes = [self._security.new_recovery_code() for _ in range(self._RECOVERY_CODE_COUNT)]
        for code in codes:
            db.add(
                RecoveryCode(
                    user_id=user_id,
                    batch_id=batch_id,
                    lookup_hash=self._security.recovery_code_lookup_hash(code),
                    code_hash=self._security.hash_recovery_code(code),
                )
            )
        return codes

    async def _consume_recovery_code(
        self,
        db: AsyncSession,
        user_id: UUID,
        code: str,
        now: datetime,
    ) -> bool:
        recovery_code = await db.scalar(
            select(RecoveryCode)
            .where(
                RecoveryCode.user_id == user_id,
                RecoveryCode.lookup_hash == self._security.recovery_code_lookup_hash(code),
                RecoveryCode.used_at.is_(None),
                RecoveryCode.revoked_at.is_(None),
            )
            .with_for_update()
        )
        if recovery_code is None or not self._security.verify_recovery_code(
            recovery_code.code_hash,
            code,
        ):
            return False
        recovery_code.used_at = now
        return True

    @staticmethod
    def _failed_audit(request_id: str, user_id: UUID, method: str) -> AuditEvent:
        return new_audit_event(
            request_id=request_id,
            event_type="identity.totp_verification_failed",
            result="denied",
            actor_id=user_id,
            target_type="user",
            target_id=user_id,
            metadata={"method": method},
        )

    @staticmethod
    def _invalid_code_error() -> APIError:
        return APIError(
            code="AUTH_MFA_INVALID",
            message="The verification code is invalid or has already been used.",
            status_code=401,
        )

    @staticmethod
    def _challenge_error() -> APIError:
        return APIError(
            code="AUTH_MFA_CHALLENGE_INVALID",
            message="The verification challenge is invalid or has expired.",
            status_code=401,
        )

    @staticmethod
    def _enrollment_error() -> APIError:
        return APIError(
            code="AUTH_TOTP_ENROLLMENT_INVALID",
            message="The TOTP enrollment is missing, expired or already completed.",
            status_code=409,
        )
