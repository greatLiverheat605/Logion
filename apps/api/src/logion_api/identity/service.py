from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import (
    AuthSession,
    Device,
    MfaChallenge,
    PasswordCredential,
    RefreshToken,
    TotpCredential,
    User,
)
from logion_api.identity.schemas import LoginRequest, RegisterRequest
from logion_api.identity.security import IdentitySecurity, SessionSecrets


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def require_verified_email(user: User) -> None:
    if user.email_verified_at is None:
        raise APIError(
            code="AUTH_EMAIL_VERIFICATION_REQUIRED",
            message="Verify the account email before continuing.",
            status_code=403,
        )


@dataclass(frozen=True)
class IssuedSession:
    user: User
    session: AuthSession
    device: Device
    secrets: SessionSecrets


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: AuthSession
    device: Device


@dataclass(frozen=True)
class RefreshOutcome:
    issued: IssuedSession | None
    reuse_detected: bool = False


@dataclass(frozen=True)
class PasswordLoginOutcome:
    issued: IssuedSession | None = None
    mfa_challenge_token: str | None = None
    mfa_challenge_expires_at: datetime | None = None


class IdentityService:
    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security

    async def register(
        self,
        db: AsyncSession,
        payload: RegisterRequest,
        *,
        request_id: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> IssuedSession | None:
        normalized = normalize_email(str(payload.email))
        existing = await db.scalar(select(User.id).where(User.email_normalized == normalized))
        if existing is not None:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.registration_rejected",
                    result="duplicate",
                    metadata={"email_hash": self._security.privacy_hash(normalized)},
                )
            )
            return None

        user = User(
            email=str(payload.email),
            email_normalized=normalized,
            email_verified_at=datetime.now(UTC),
        )
        user.password_credential = PasswordCredential(
            password_hash=self._security.hash_password(payload.password),
        )
        db.add(user)
        await db.flush()
        issued = await self.issue_session(
            db,
            user=user,
            device_name=payload.device_name,
            platform=payload.platform,
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
            event_type="identity.registered",
        )
        return issued

    async def login(
        self,
        db: AsyncSession,
        payload: LoginRequest,
        *,
        request_id: str,
        ip_address: str | None,
        user_agent: str | None,
        device_cookie: str | None,
    ) -> PasswordLoginOutcome | None:
        normalized = normalize_email(str(payload.email))
        result = await db.execute(
            select(User, PasswordCredential)
            .join(PasswordCredential, PasswordCredential.user_id == User.id)
            .where(User.email_normalized == normalized)
        )
        row = result.one_or_none()
        user = row[0] if row else None
        credential = row[1] if row else None
        password_valid = self._security.verify_password(
            credential.password_hash if credential else None,
            payload.password,
        )
        if (
            user is None
            or credential is None
            or not password_valid
            or user.status not in {"active", "pending_deletion"}
            or user.email_verified_at is None
        ):
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.login_failed",
                    result="denied",
                    actor_id=user.id if user else None,
                    target_id=user.id if user else None,
                    metadata={"email_hash": self._security.privacy_hash(normalized)},
                )
            )
            return None

        if self._security.password_needs_rehash(credential.password_hash):
            credential.password_hash = self._security.hash_password(payload.password)
            credential.updated_at = datetime.now(UTC)

        totp_enabled = await db.scalar(
            select(TotpCredential.user_id).where(
                TotpCredential.user_id == user.id,
                TotpCredential.verified_at.is_not(None),
            )
        )
        if totp_enabled is not None:
            challenge_token = self._security.new_mfa_challenge_token()
            expires_at = datetime.now(UTC) + timedelta(
                seconds=self._settings.totp_challenge_ttl_seconds
            )
            challenge = MfaChallenge(
                user_id=user.id,
                token_hash=self._security.token_hash(challenge_token),
                device_name=payload.device_name.strip(),
                platform=payload.platform,
                request_id=request_id,
                ip_hash=self._security.privacy_hash(ip_address),
                user_agent_hash=self._security.privacy_hash(user_agent),
                expires_at=expires_at,
            )
            db.add(challenge)
            await db.flush()
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.password_verified_mfa_required",
                    result="pending",
                    actor_id=user.id,
                    target_type="mfa_challenge",
                    target_id=challenge.id,
                )
            )
            return PasswordLoginOutcome(
                mfa_challenge_token=challenge_token,
                mfa_challenge_expires_at=expires_at,
            )

        device = await self.find_reusable_device(db, user.id, device_cookie)
        issued = await self.issue_session(
            db,
            user=user,
            device=device,
            device_name=payload.device_name,
            platform=payload.platform,
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent,
            event_type="identity.login_succeeded",
        )
        return PasswordLoginOutcome(issued=issued)

    async def authenticate_access(self, db: AsyncSession, access_token: str | None) -> AuthContext:
        if not access_token:
            raise self._authentication_error()
        now = datetime.now(UTC)
        result = await db.execute(
            select(AuthSession, User, Device)
            .join(User, User.id == AuthSession.user_id)
            .join(Device, Device.id == AuthSession.device_id)
            .where(
                AuthSession.access_token_hash == self._security.token_hash(access_token),
                AuthSession.revoked_at.is_(None),
                AuthSession.access_expires_at > now,
                User.status == "active",
                Device.revoked_at.is_(None),
            )
        )
        row = result.one_or_none()
        if row is None:
            raise self._authentication_error()
        return AuthContext(session=row[0], user=row[1], device=row[2])

    async def authenticate_deletion_access(
        self, db: AsyncSession, access_token: str | None
    ) -> AuthContext:
        if not access_token:
            raise self._authentication_error()
        now = datetime.now(UTC)
        result = await db.execute(
            select(AuthSession, User, Device)
            .join(User, User.id == AuthSession.user_id)
            .join(Device, Device.id == AuthSession.device_id)
            .where(
                AuthSession.access_token_hash == self._security.token_hash(access_token),
                AuthSession.revoked_at.is_(None),
                AuthSession.access_expires_at > now,
                User.status == "pending_deletion",
                Device.revoked_at.is_(None),
            )
        )
        row = result.one_or_none()
        if row is None:
            raise self._authentication_error()
        return AuthContext(session=row[0], user=row[1], device=row[2])

    def require_recent_authentication(self, context: AuthContext) -> None:
        cutoff = datetime.now(UTC) - timedelta(seconds=self._settings.recent_auth_ttl_seconds)
        if context.session.created_at < cutoff:
            raise APIError(
                code="AUTH_RECENT_LOGIN_REQUIRED",
                message="Sign in again before changing authentication methods.",
                status_code=403,
            )

    async def refresh(
        self,
        db: AsyncSession,
        *,
        refresh_token: str | None,
        csrf_header: str | None,
        csrf_cookie: str | None,
        request_id: str,
    ) -> RefreshOutcome:
        if not refresh_token:
            raise self._authentication_error()

        result = await db.execute(
            select(RefreshToken, AuthSession, User, Device)
            .join(AuthSession, AuthSession.id == RefreshToken.session_id)
            .join(User, User.id == AuthSession.user_id)
            .join(Device, Device.id == AuthSession.device_id)
            .where(RefreshToken.token_hash == self._security.token_hash(refresh_token))
            .with_for_update()
        )
        row = result.one_or_none()
        if row is None:
            raise self._authentication_error()

        token, auth_session, user, device = row
        self.validate_csrf(auth_session, csrf_header, csrf_cookie)
        now = datetime.now(UTC)
        if token.status != "active":
            await self._revoke_session(db, auth_session, reason="refresh_reuse", now=now)
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.refresh_reuse_detected",
                    result="revoked",
                    actor_id=user.id,
                    target_id=auth_session.id,
                )
            )
            return RefreshOutcome(issued=None, reuse_detected=True)

        if (
            token.expires_at <= now
            or auth_session.refresh_expires_at <= now
            or auth_session.revoked_at is not None
            or device.revoked_at is not None
            or user.status not in {"active", "pending_deletion"}
            or user.email_verified_at is None
        ):
            await self._revoke_session(db, auth_session, reason="expired", now=now)
            return RefreshOutcome(issued=None)

        access_token = self._security.new_access_token()
        next_refresh_token = self._security.new_refresh_token()
        next_token = RefreshToken(
            session_id=auth_session.id,
            token_hash=self._security.token_hash(next_refresh_token),
            expires_at=auth_session.refresh_expires_at,
        )
        db.add(next_token)
        await db.flush()

        token.status = "rotated"
        token.used_at = now
        token.replaced_by_id = next_token.id
        auth_session.access_token_hash = self._security.token_hash(access_token)
        auth_session.access_expires_at = now + timedelta(minutes=self._settings.access_ttl_minutes)
        auth_session.last_seen_at = now
        auth_session.rotation_counter += 1
        device.last_seen_at = now
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.session_refreshed",
                result="success",
                actor_id=user.id,
                target_id=auth_session.id,
                metadata={"rotation_counter": auth_session.rotation_counter},
            )
        )
        secrets = SessionSecrets(
            access_token=access_token,
            refresh_token=next_refresh_token,
            csrf_token=csrf_cookie or "",
        )
        return RefreshOutcome(
            issued=IssuedSession(user=user, session=auth_session, device=device, secrets=secrets)
        )

    def validate_csrf(
        self,
        auth_session: AuthSession,
        csrf_header: str | None,
        csrf_cookie: str | None,
    ) -> None:
        if not csrf_header or not csrf_cookie:
            raise self._csrf_error()
        if not self._security.constant_time_equal(csrf_header, csrf_cookie):
            raise self._csrf_error()
        expected_hash = self._security.token_hash(csrf_cookie)
        if not self._security.constant_time_equal(expected_hash, auth_session.csrf_token_hash):
            raise self._csrf_error()

    async def list_devices(self, db: AsyncSession, context: AuthContext) -> list[Device]:
        result = await db.scalars(
            select(Device)
            .where(Device.user_id == context.user.id)
            .order_by(Device.last_seen_at.desc())
        )
        return list(result.all())

    async def revoke_device(
        self,
        db: AsyncSession,
        context: AuthContext,
        device_id: UUID,
        *,
        request_id: str,
    ) -> bool:
        device = await db.scalar(
            select(Device).where(Device.id == device_id, Device.user_id == context.user.id)
        )
        if device is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message="The device was not found.",
                status_code=404,
            )
        now = datetime.now(UTC)
        device.revoked_at = device.revoked_at or now
        await db.execute(
            update(AuthSession)
            .where(AuthSession.device_id == device.id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason="device_revoked")
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.device_revoked",
                result="success",
                actor_id=context.user.id,
                target_type="device",
                target_id=device.id,
            )
        )
        return device.id == context.device.id

    async def logout(
        self,
        db: AsyncSession,
        context: AuthContext,
        *,
        request_id: str,
    ) -> None:
        await self._revoke_session(db, context.session, reason="logout", now=datetime.now(UTC))
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.logout",
                result="success",
                actor_id=context.user.id,
                target_id=context.session.id,
            )
        )

    async def issue_session(
        self,
        db: AsyncSession,
        *,
        user: User,
        device_name: str,
        platform: str,
        request_id: str,
        ip_address: str | None,
        user_agent: str | None,
        event_type: str,
        device: Device | None = None,
        event_metadata: dict[str, str] | None = None,
    ) -> IssuedSession:
        now = datetime.now(UTC)
        if device is None:
            device = Device(
                user_id=user.id,
                name=device_name.strip(),
                platform=platform,
                ip_hash=self._security.privacy_hash(ip_address),
                user_agent_hash=self._security.privacy_hash(user_agent),
            )
            db.add(device)
            await db.flush()
        else:
            device.name = device_name.strip()
            device.platform = platform
            device.ip_hash = self._security.privacy_hash(ip_address)
            device.user_agent_hash = self._security.privacy_hash(user_agent)
            device.last_seen_at = now

        secrets = self._security.new_session_secrets()
        auth_session = AuthSession(
            user_id=user.id,
            device_id=device.id,
            access_token_hash=self._security.token_hash(secrets.access_token),
            csrf_token_hash=self._security.token_hash(secrets.csrf_token),
            access_expires_at=now + timedelta(minutes=self._settings.access_ttl_minutes),
            refresh_expires_at=now + timedelta(days=self._settings.refresh_ttl_days),
        )
        db.add(auth_session)
        await db.flush()
        db.add(
            RefreshToken(
                session_id=auth_session.id,
                token_hash=self._security.token_hash(secrets.refresh_token),
                expires_at=auth_session.refresh_expires_at,
            )
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=event_type,
                result="success",
                actor_id=user.id,
                target_id=auth_session.id,
                metadata={"device_id": str(device.id), **(event_metadata or {})},
            )
        )
        return IssuedSession(user=user, session=auth_session, device=device, secrets=secrets)

    async def find_reusable_device(
        self,
        db: AsyncSession,
        user_id: UUID,
        device_cookie: str | None,
    ) -> Device | None:
        if not device_cookie:
            return None
        try:
            device_id = UUID(device_cookie)
        except ValueError:
            return None
        return cast(
            Device | None,
            await db.scalar(
                select(Device).where(
                    Device.id == device_id,
                    Device.user_id == user_id,
                    Device.revoked_at.is_(None),
                )
            ),
        )

    async def _revoke_session(
        self,
        db: AsyncSession,
        auth_session: AuthSession,
        *,
        reason: str,
        now: datetime,
    ) -> None:
        auth_session.revoked_at = auth_session.revoked_at or now
        auth_session.revoke_reason = auth_session.revoke_reason or reason
        await db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.session_id == auth_session.id,
                RefreshToken.status == "active",
            )
            .values(status="revoked", used_at=now)
        )

    @staticmethod
    def _authentication_error() -> APIError:
        return APIError(
            code="AUTH_INVALID_SESSION",
            message="Authentication is required or the session has expired.",
            status_code=401,
            clear_auth_cookies=True,
        )

    @staticmethod
    def _csrf_error() -> APIError:
        return APIError(
            code="AUTH_CSRF_INVALID",
            message="The request could not be verified.",
            status_code=403,
        )
