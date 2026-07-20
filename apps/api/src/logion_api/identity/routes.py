from typing import Protocol
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status
from sqlalchemy.exc import IntegrityError
from starlette.responses import JSONResponse

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    clear_auth_cookies,
    client_ip,
    get_security,
    request_id,
    require_trusted_origin,
    set_auth_cookies,
)
from logion_api.identity.schemas import (
    AuthResponse,
    DeviceListResponse,
    DeviceResponse,
    LoginRequest,
    MessageResponse,
    MfaChallengeResponse,
    RegisterRequest,
    UserResponse,
)
from logion_api.identity.service import normalize_email
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

router = APIRouter(prefix="/api/v1/auth", tags=["identity"])

ERROR_RESPONSE = {"model": ErrorResponse}


class RateLimitEnforcer(Protocol):
    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None: ...


async def _enforce_login_rate_limits(
    limiter: RateLimitEnforcer,
    settings: SettingsDependency,
    *,
    client_ip_value: str | None,
    normalized_email: str,
) -> None:
    security = get_security()
    subjects = (
        (
            "login_ip",
            client_ip_value or "unknown",
            settings.login_ip_limit_per_five_minutes,
        ),
        (
            "login_account",
            normalized_email,
            settings.login_account_limit_per_five_minutes,
        ),
    )
    for scope, identity, limit in subjects:
        subject_hash = security.privacy_hash(identity) or "unknown"
        await limiter.enforce(
            scope=scope,
            subject_hash=subject_hash,
            limit=limit,
            window=300,
        )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="auth_register",
    responses={
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        410: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> AuthResponse:
    require_trusted_origin(request, settings)
    if not settings.legacy_registration_enabled:
        raise APIError(
            code="AUTH_REGISTRATION_UPGRADE_REQUIRED",
            message="Use the email verification registration flow.",
            status_code=410,
        )
    subject = get_security().privacy_hash(client_ip(request) or "unknown") or "unknown"
    await limiter.enforce(
        scope="register",
        subject_hash=subject,
        limit=settings.registration_limit_per_hour,
        window=3600,
    )
    issued = await service.register(
        db,
        payload,
        request_id=request_id(request),
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    if issued is not None:
        await workspaces.provision_personal_workspace(
            db,
            issued.user.id,
            request_id=request_id(request),
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise APIError(
            code="AUTH_EMAIL_EXISTS",
            message="An account already uses this email address.",
            status_code=409,
        ) from exc
    if issued is None:
        raise APIError(
            code="AUTH_EMAIL_EXISTS",
            message="An account already uses this email address.",
            status_code=409,
        )
    set_auth_cookies(response, issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(issued.user),
        session_expires_at=issued.session.access_expires_at,
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    operation_id="auth_login",
    responses={
        202: {"model": MfaChallengeResponse},
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> AuthResponse | JSONResponse:
    require_trusted_origin(request, settings)
    await _enforce_login_rate_limits(
        limiter,
        settings,
        client_ip_value=client_ip(request),
        normalized_email=normalize_email(str(payload.email)),
    )
    outcome = await service.login(
        db,
        payload,
        request_id=request_id(request),
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent"),
        device_cookie=request.cookies.get(settings.device_cookie_name),
    )
    await db.commit()
    if outcome is None:
        raise APIError(
            code="AUTH_INVALID_CREDENTIALS",
            message="The email or password is incorrect.",
            status_code=401,
        )
    if outcome.mfa_challenge_token is not None:
        if outcome.mfa_challenge_expires_at is None:
            raise RuntimeError("MFA challenge expiry is required")
        challenge_response = MfaChallengeResponse(
            challenge_token=outcome.mfa_challenge_token,
            expires_at=outcome.mfa_challenge_expires_at,
            methods=["totp", "recovery_code"],
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=challenge_response.model_dump(mode="json"),
            headers={"Cache-Control": "no-store"},
        )
    if outcome.issued is None:
        raise RuntimeError("Password login outcome is incomplete")
    set_auth_cookies(response, outcome.issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(outcome.issued.user),
        session_expires_at=outcome.issued.session.access_expires_at,
    )


@router.post(
    "/refresh",
    response_model=AuthResponse,
    operation_id="auth_refresh",
    responses={401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE},
)
async def refresh(
    request: Request,
    response: Response,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AuthResponse:
    require_trusted_origin(request, settings)
    outcome = await service.refresh(
        db,
        refresh_token=request.cookies.get(settings.refresh_cookie_name),
        csrf_header=x_csrf_token,
        csrf_cookie=request.cookies.get(settings.csrf_cookie_name),
        request_id=request_id(request),
    )
    await db.commit()
    if outcome.issued is None:
        code = "AUTH_REFRESH_REUSED" if outcome.reuse_detected else "AUTH_INVALID_SESSION"
        raise APIError(
            code=code,
            message="The session is no longer valid. Sign in again.",
            status_code=401,
            clear_auth_cookies=True,
        )
    set_auth_cookies(response, outcome.issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(outcome.issued.user),
        session_expires_at=outcome.issued.session.access_expires_at,
    )


@router.get(
    "/me",
    response_model=UserResponse,
    operation_id="auth_me",
    responses={401: ERROR_RESPONSE},
)
async def me(context: AuthContextDependency) -> UserResponse:
    return UserResponse.model_validate(context.user)


@router.post(
    "/logout",
    response_model=MessageResponse,
    operation_id="auth_logout",
    responses={401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 422: ERROR_RESPONSE},
)
async def logout(
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MessageResponse:
    require_trusted_origin(request, settings)
    service.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    await service.logout(db, context, request_id=request_id(request))
    await db.commit()
    clear_auth_cookies(response, settings)
    return MessageResponse()


@router.get(
    "/devices",
    response_model=DeviceListResponse,
    operation_id="auth_list_devices",
    responses={401: ERROR_RESPONSE},
)
async def list_devices(
    context: AuthContextDependency,
    db: DatabaseSession,
    service: IdentityServiceDependency,
) -> DeviceListResponse:
    devices = await service.list_devices(db, context)
    return DeviceListResponse(
        devices=[
            DeviceResponse.model_validate(device).model_copy(
                update={"current": device.id == context.device.id}
            )
            for device in devices
        ]
    )


@router.delete(
    "/devices/{device_id}",
    response_model=MessageResponse,
    operation_id="auth_revoke_device",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
    },
)
async def revoke_device(
    device_id: UUID,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MessageResponse:
    require_trusted_origin(request, settings)
    service.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    revoked_current = await service.revoke_device(
        db,
        context,
        device_id,
        request_id=request_id(request),
    )
    await db.commit()
    if revoked_current:
        clear_auth_cookies(response, settings)
    return MessageResponse()
