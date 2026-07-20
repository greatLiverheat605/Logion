from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status
from sqlalchemy.exc import IntegrityError

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    PasskeyServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    client_ip,
    get_security,
    request_id,
    require_webauthn_origin,
    set_auth_cookies,
)
from logion_api.identity.schemas import (
    AuthResponse,
    MessageResponse,
    PasskeyAuthenticationOptionsResponse,
    PasskeyAuthenticationPublicKey,
    PasskeyAuthenticationVerifyRequest,
    PasskeyCredentialListResponse,
    PasskeyCredentialResponse,
    PasskeyRegistrationOptionsResponse,
    PasskeyRegistrationPublicKey,
    PasskeyRegistrationVerifyRequest,
    UserResponse,
)

router = APIRouter(prefix="/api/v1/auth/passkeys", tags=["identity"])

ERROR_RESPONSE = {"model": ErrorResponse}


def _csrf_cookie(request: Request, settings: SettingsDependency) -> str | None:
    return request.cookies.get(settings.csrf_cookie_name)


async def _enforce_passkey_rate_limit(
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    *,
    scope: str,
    identity: str,
) -> None:
    subject = get_security().privacy_hash(identity) or "unknown"
    await limiter.enforce(
        scope=scope,
        subject_hash=subject,
        limit=settings.passkey_limit_per_five_minutes,
        window=300,
    )


@router.post(
    "/register/options",
    response_model=PasskeyRegistrationOptionsResponse,
    operation_id="auth_passkey_registration_options",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def registration_options(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    passkeys: PasskeyServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> PasskeyRegistrationOptionsResponse:
    require_webauthn_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_passkey_rate_limit(
        limiter,
        settings,
        scope="passkey_registration_options",
        identity=str(context.user.id),
    )
    generated = await passkeys.registration_options(
        db,
        context,
        request_id=request_id(request),
        ip_address=client_ip(request),
    )
    await db.commit()
    return PasskeyRegistrationOptionsResponse(
        challenge_id=generated.challenge_id,
        public_key=PasskeyRegistrationPublicKey.model_validate(generated.public_key),
    )


@router.post(
    "/register/verify",
    response_model=PasskeyCredentialResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="auth_passkey_registration_verify",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def registration_verify(
    payload: PasskeyRegistrationVerifyRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    passkeys: PasskeyServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> PasskeyCredentialResponse:
    origin = require_webauthn_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_passkey_rate_limit(
        limiter,
        settings,
        scope="passkey_registration_verify",
        identity=str(context.user.id),
    )
    challenge = await passkeys.consume_challenge(
        db,
        payload.challenge_id,
        purpose="registration",
        user_id=context.user.id,
    )
    await db.commit()
    try:
        credential = await passkeys.complete_registration(
            db,
            context,
            challenge,
            payload.credential,
            name=payload.name,
            request_id=request_id(request),
            expected_origin=origin,
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise APIError(
            code="AUTH_PASSKEY_EXISTS",
            message="This Passkey is already registered.",
            status_code=409,
        ) from exc
    except APIError:
        await db.commit()
        raise
    return PasskeyCredentialResponse.model_validate(credential)


@router.post(
    "/login/options",
    response_model=PasskeyAuthenticationOptionsResponse,
    operation_id="auth_passkey_authentication_options",
    responses={403: ERROR_RESPONSE, 422: ERROR_RESPONSE, 429: ERROR_RESPONSE, 503: ERROR_RESPONSE},
)
async def authentication_options(
    request: Request,
    db: DatabaseSession,
    passkeys: PasskeyServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> PasskeyAuthenticationOptionsResponse:
    require_webauthn_origin(request, settings)
    await _enforce_passkey_rate_limit(
        limiter,
        settings,
        scope="passkey_authentication_options",
        identity=client_ip(request) or "unknown",
    )
    generated = await passkeys.authentication_options(
        db,
        request_id=request_id(request),
        ip_address=client_ip(request),
    )
    await db.commit()
    return PasskeyAuthenticationOptionsResponse(
        challenge_id=generated.challenge_id,
        public_key=PasskeyAuthenticationPublicKey.model_validate(generated.public_key),
    )


@router.post(
    "/login/verify",
    response_model=AuthResponse,
    operation_id="auth_passkey_authentication_verify",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def authentication_verify(
    payload: PasskeyAuthenticationVerifyRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    passkeys: PasskeyServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> AuthResponse:
    origin = require_webauthn_origin(request, settings)
    await _enforce_passkey_rate_limit(
        limiter,
        settings,
        scope="passkey_authentication_verify",
        identity=client_ip(request) or "unknown",
    )
    challenge = await passkeys.consume_challenge(
        db,
        payload.challenge_id,
        purpose="authentication",
    )
    await db.commit()
    try:
        authenticated = await passkeys.authenticate(
            db,
            challenge,
            payload.credential,
            request_id=request_id(request),
            expected_origin=origin,
        )
        device = await identity.find_reusable_device(
            db,
            authenticated.user.id,
            request.cookies.get(settings.device_cookie_name),
        )
        issued = await identity.issue_session(
            db,
            user=authenticated.user,
            device=device,
            device_name=payload.device_name,
            platform=payload.platform,
            request_id=request_id(request),
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            event_type="identity.login_succeeded",
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    set_auth_cookies(response, issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(issued.user),
        session_expires_at=issued.session.access_expires_at,
    )


@router.get(
    "",
    response_model=PasskeyCredentialListResponse,
    operation_id="auth_passkey_list",
    responses={401: ERROR_RESPONSE},
)
async def list_passkeys(
    context: AuthContextDependency,
    db: DatabaseSession,
    passkeys: PasskeyServiceDependency,
) -> PasskeyCredentialListResponse:
    credentials = await passkeys.list_credentials(db, context)
    return PasskeyCredentialListResponse(
        credentials=[PasskeyCredentialResponse.model_validate(item) for item in credentials]
    )


@router.delete(
    "/{credential_id}",
    response_model=MessageResponse,
    operation_id="auth_passkey_revoke",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
    },
)
async def revoke_passkey(
    credential_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    passkeys: PasskeyServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MessageResponse:
    require_webauthn_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await passkeys.revoke_credential(
        db,
        context,
        credential_id,
        request_id=request_id(request),
    )
    await db.commit()
    return MessageResponse()
