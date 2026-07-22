import hmac
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import (
    parse_authentication_credential_json,
    parse_registration_credential_json,
)
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidJSONStructure,
    InvalidRegistrationResponse,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent, PasskeyCredential, User, WebAuthnChallenge
from logion_api.identity.schemas import (
    AuthenticationCredentialRequest,
    RegistrationCredentialRequest,
)
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, require_verified_email


@dataclass(frozen=True)
class GeneratedPasskeyOptions:
    challenge_id: UUID
    public_key: dict[str, Any]


@dataclass(frozen=True)
class AuthenticatedPasskey:
    user: User
    credential: PasskeyCredential


def _authentication_credential_statement(
    credential_id: bytes,
) -> Select[tuple[PasskeyCredential, User]]:
    return (
        select(PasskeyCredential, User)
        .join(User, User.id == PasskeyCredential.user_id)
        .where(
            PasskeyCredential.credential_id == credential_id,
            PasskeyCredential.revoked_at.is_(None),
            User.status.in_(("active", "pending_deletion")),
            User.email_verified_at.is_not(None),
        )
        .with_for_update(of=PasskeyCredential)
    )


class PasskeyService:
    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security

    async def registration_options(
        self,
        db: AsyncSession,
        context: AuthContext,
        *,
        request_id: str,
        ip_address: str | None,
    ) -> GeneratedPasskeyOptions:
        require_verified_email(context.user)
        active_count = await db.scalar(
            select(func.count(PasskeyCredential.id)).where(
                PasskeyCredential.user_id == context.user.id,
                PasskeyCredential.revoked_at.is_(None),
            )
        )
        if int(active_count or 0) >= self._settings.passkey_max_credentials:
            raise APIError(
                code="AUTH_PASSKEY_LIMIT_REACHED",
                message="Remove an existing Passkey before adding another one.",
                status_code=409,
            )

        credentials = await db.scalars(
            select(PasskeyCredential).where(
                PasskeyCredential.user_id == context.user.id,
                PasskeyCredential.revoked_at.is_(None),
            )
        )
        exclude_credentials = [
            PublicKeyCredentialDescriptor(
                id=credential.credential_id,
                transports=self._parse_transports(credential.transports),
            )
            for credential in credentials.all()
        ]
        options = generate_registration_options(
            rp_id=self._settings.webauthn_rp_id,
            rp_name=self._settings.webauthn_rp_name,
            user_id=context.user.id.bytes,
            user_name=context.user.email,
            user_display_name=context.user.email,
            timeout=self._settings.webauthn_challenge_ttl_seconds * 1000,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                require_resident_key=True,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=exclude_credentials,
        )
        challenge = await self._store_challenge(
            db,
            purpose="registration",
            challenge=options.challenge,
            request_id=request_id,
            ip_address=ip_address,
            user_id=context.user.id,
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.passkey_registration_started",
                result="issued",
                actor_id=context.user.id,
                target_type="webauthn_challenge",
                target_id=challenge.id,
            )
        )
        return GeneratedPasskeyOptions(
            challenge_id=challenge.id,
            public_key=cast(dict[str, Any], json.loads(options_to_json(options))),
        )

    async def authentication_options(
        self,
        db: AsyncSession,
        *,
        request_id: str,
        ip_address: str | None,
    ) -> GeneratedPasskeyOptions:
        options = generate_authentication_options(
            rp_id=self._settings.webauthn_rp_id,
            timeout=self._settings.webauthn_challenge_ttl_seconds * 1000,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
        challenge = await self._store_challenge(
            db,
            purpose="authentication",
            challenge=options.challenge,
            request_id=request_id,
            ip_address=ip_address,
        )
        return GeneratedPasskeyOptions(
            challenge_id=challenge.id,
            public_key=cast(dict[str, Any], json.loads(options_to_json(options))),
        )

    async def consume_challenge(
        self,
        db: AsyncSession,
        challenge_id: UUID,
        *,
        purpose: Literal["registration", "authentication"],
        user_id: UUID | None = None,
    ) -> WebAuthnChallenge:
        challenge = await db.scalar(
            select(WebAuthnChallenge)
            .where(WebAuthnChallenge.id == challenge_id)
            .with_for_update()
        )
        now = datetime.now(UTC)
        valid = (
            challenge is not None
            and challenge.purpose == purpose
            and challenge.used_at is None
            and challenge.expires_at > now
            and (purpose == "authentication" or challenge.user_id == user_id)
        )
        if not valid or challenge is None:
            raise APIError(
                code="AUTH_PASSKEY_CHALLENGE_INVALID",
                message="The Passkey request has expired or was already used.",
                status_code=401 if purpose == "authentication" else 409,
            )
        challenge.used_at = now
        return challenge

    async def complete_registration(
        self,
        db: AsyncSession,
        context: AuthContext,
        challenge: WebAuthnChallenge,
        credential_request: RegistrationCredentialRequest,
        *,
        name: str,
        request_id: str,
        expected_origin: str,
    ) -> PasskeyCredential:
        require_verified_email(context.user)
        try:
            parsed = parse_registration_credential_json(
                credential_request.model_dump(by_alias=True, exclude_none=True)
            )
            verification = verify_registration_response(
                credential=parsed,
                expected_challenge=challenge.challenge,
                expected_rp_id=self._settings.webauthn_rp_id,
                expected_origin=expected_origin,
                require_user_verification=True,
            )
        except (InvalidJSONStructure, InvalidRegistrationResponse, ValueError) as exc:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.passkey_registration_failed",
                    result="denied",
                    actor_id=context.user.id,
                    target_type="webauthn_challenge",
                    target_id=challenge.id,
                )
            )
            raise self._verification_error() from exc

        existing = await db.scalar(
            select(PasskeyCredential.id).where(
                PasskeyCredential.credential_id == verification.credential_id
            )
        )
        if existing is not None:
            raise APIError(
                code="AUTH_PASSKEY_EXISTS",
                message="This Passkey is already registered.",
                status_code=409,
            )
        if len(verification.credential_id) > 1024 or len(verification.credential_public_key) > 4096:
            raise self._verification_error()

        passkey = PasskeyCredential(
            user_id=context.user.id,
            credential_id=verification.credential_id,
            public_key=verification.credential_public_key,
            name=name.strip(),
            sign_count=verification.sign_count,
            aaguid=UUID(verification.aaguid),
            transports=[transport.value for transport in parsed.response.transports or []],
            credential_device_type=verification.credential_device_type.value,
            backed_up=verification.credential_backed_up,
        )
        db.add(passkey)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.passkey_registered",
                result="success",
                actor_id=context.user.id,
                target_type="passkey_credential",
                target_id=passkey.id,
                metadata={"aaguid": str(passkey.aaguid)},
            )
        )
        return passkey

    async def authenticate(
        self,
        db: AsyncSession,
        challenge: WebAuthnChallenge,
        credential_request: AuthenticationCredentialRequest,
        *,
        request_id: str,
        expected_origin: str,
    ) -> AuthenticatedPasskey:
        try:
            parsed = parse_authentication_credential_json(
                credential_request.model_dump(by_alias=True, exclude_none=True)
            )
        except (InvalidJSONStructure, InvalidAuthenticationResponse, ValueError) as exc:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.passkey_login_failed",
                    result="denied",
                    target_type="webauthn_challenge",
                    target_id=challenge.id,
                )
            )
            raise self._authentication_error() from exc

        result = await db.execute(_authentication_credential_statement(parsed.raw_id))
        row = result.one_or_none()
        if row is None:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.passkey_login_failed",
                    result="denied",
                    target_type="webauthn_challenge",
                    target_id=challenge.id,
                )
            )
            raise self._authentication_error()
        passkey, user = row
        if parsed.response.user_handle is None or not hmac.compare_digest(
            parsed.response.user_handle,
            user.id.bytes,
        ):
            db.add(self._failed_login_audit(request_id, user.id, passkey.id))
            raise self._authentication_error()

        try:
            verification = verify_authentication_response(
                credential=parsed,
                expected_challenge=challenge.challenge,
                expected_rp_id=self._settings.webauthn_rp_id,
                expected_origin=expected_origin,
                credential_public_key=passkey.public_key,
                credential_current_sign_count=0,
                require_user_verification=True,
            )
        except (InvalidJSONStructure, InvalidAuthenticationResponse, ValueError) as exc:
            db.add(self._failed_login_audit(request_id, user.id, passkey.id))
            raise self._authentication_error() from exc

        now = datetime.now(UTC)
        if (
            verification.new_sign_count > 0 or passkey.sign_count > 0
        ) and verification.new_sign_count <= passkey.sign_count:
            passkey.revoked_at = now
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="identity.passkey_counter_regression",
                    result="revoked",
                    actor_id=user.id,
                    target_type="passkey_credential",
                    target_id=passkey.id,
                )
            )
            raise self._authentication_error()

        passkey.sign_count = verification.new_sign_count
        passkey.credential_device_type = verification.credential_device_type.value
        passkey.backed_up = verification.credential_backed_up
        passkey.last_used_at = now
        passkey.updated_at = now
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.passkey_login_succeeded",
                result="success",
                actor_id=user.id,
                target_type="passkey_credential",
                target_id=passkey.id,
            )
        )
        return AuthenticatedPasskey(user=user, credential=passkey)

    async def list_credentials(
        self,
        db: AsyncSession,
        context: AuthContext,
    ) -> list[PasskeyCredential]:
        result = await db.scalars(
            select(PasskeyCredential)
            .where(
                PasskeyCredential.user_id == context.user.id,
                PasskeyCredential.revoked_at.is_(None),
            )
            .order_by(PasskeyCredential.created_at.desc())
        )
        return list(result.all())

    async def revoke_credential(
        self,
        db: AsyncSession,
        context: AuthContext,
        credential_id: UUID,
        *,
        request_id: str,
    ) -> None:
        credential = await db.scalar(
            select(PasskeyCredential).where(
                PasskeyCredential.id == credential_id,
                PasskeyCredential.user_id == context.user.id,
            )
        )
        if credential is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message="The Passkey was not found.",
                status_code=404,
            )
        credential.revoked_at = credential.revoked_at or datetime.now(UTC)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="identity.passkey_revoked",
                result="success",
                actor_id=context.user.id,
                target_type="passkey_credential",
                target_id=credential.id,
            )
        )

    async def _store_challenge(
        self,
        db: AsyncSession,
        *,
        purpose: Literal["registration", "authentication"],
        challenge: bytes,
        request_id: str,
        ip_address: str | None,
        user_id: UUID | None = None,
    ) -> WebAuthnChallenge:
        model = WebAuthnChallenge(
            user_id=user_id,
            purpose=purpose,
            challenge=challenge,
            request_id=request_id,
            ip_hash=self._security.privacy_hash(ip_address),
            expires_at=datetime.now(UTC)
            + timedelta(seconds=self._settings.webauthn_challenge_ttl_seconds),
        )
        db.add(model)
        await db.flush()
        return model

    @staticmethod
    def _parse_transports(values: list[str]) -> list[AuthenticatorTransport]:
        transports: list[AuthenticatorTransport] = []
        for value in values:
            try:
                transports.append(AuthenticatorTransport(value))
            except ValueError:
                continue
        return transports

    @staticmethod
    def _failed_login_audit(
        request_id: str,
        user_id: UUID,
        credential_id: UUID,
    ) -> AuditEvent:
        return new_audit_event(
            request_id=request_id,
            event_type="identity.passkey_login_failed",
            result="denied",
            actor_id=user_id,
            target_type="passkey_credential",
            target_id=credential_id,
        )

    @staticmethod
    def _verification_error() -> APIError:
        return APIError(
            code="AUTH_PASSKEY_VERIFICATION_FAILED",
            message="The Passkey could not be verified.",
            status_code=422,
        )

    @staticmethod
    def _authentication_error() -> APIError:
        return APIError(
            code="AUTH_PASSKEY_INVALID",
            message="Passkey authentication failed.",
            status_code=401,
        )
