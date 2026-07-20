from functools import lru_cache
from typing import Annotated, Protocol
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings, get_settings
from logion_api.db import get_session
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.rate_limit import RateLimiter
from logion_api.identity.schemas import (
    AuthResponse,
    DeviceListResponse,
    DeviceResponse,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    UserResponse,
)
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, IdentityService, IssuedSession, normalize_email

router = APIRouter(prefix="/api/v1/auth", tags=["identity"])

ERROR_RESPONSE = {"model": ErrorResponse}


@lru_cache
def get_security() -> IdentitySecurity:
    return IdentitySecurity(get_settings().secret_key.get_secret_value())


def get_identity_service() -> IdentityService:
    return IdentityService(get_settings(), get_security())


def get_rate_limiter() -> RateLimiter:
    return RateLimiter(get_settings().redis_url)


DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
IdentityServiceDependency = Annotated[IdentityService, Depends(get_identity_service)]
RateLimiterDependency = Annotated[RateLimiter, Depends(get_rate_limiter)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class RateLimitEnforcer(Protocol):
    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None: ...


def _request_id(request: Request) -> str:
    return str(request.state.request_id)


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _require_trusted_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin is None and not settings.require_origin_header:
        return
    if origin not in settings.allowed_origins:
        raise APIError(
            code="AUTH_ORIGIN_INVALID",
            message="The request origin is not allowed.",
            status_code=403,
        )


async def _enforce_login_rate_limits(
    limiter: RateLimitEnforcer,
    settings: Settings,
    *,
    client_ip: str | None,
    normalized_email: str,
) -> None:
    security = get_security()
    subjects = (
        (
            "login_ip",
            client_ip or "unknown",
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


def _set_auth_cookies(response: Response, issued: IssuedSession, settings: Settings) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.set_cookie(
        settings.access_cookie_name,
        issued.secrets.access_token,
        httponly=True,
        samesite="lax",
        max_age=settings.access_ttl_minutes * 60,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        settings.refresh_cookie_name,
        issued.secrets.refresh_token,
        httponly=True,
        samesite="strict",
        max_age=settings.refresh_ttl_days * 86400,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        settings.csrf_cookie_name,
        issued.secrets.csrf_token,
        httponly=False,
        samesite="strict",
        max_age=settings.refresh_ttl_days * 86400,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )
    response.set_cookie(
        settings.device_cookie_name,
        str(issued.device.id),
        httponly=True,
        samesite="lax",
        max_age=settings.refresh_ttl_days * 86400,
        secure=settings.cookie_secure,
        domain=settings.cookie_domain,
        path="/",
    )


def _clear_auth_cookies(response: Response, settings: Settings) -> None:
    response.headers["Cache-Control"] = "no-store"
    for name in (
        settings.access_cookie_name,
        settings.refresh_cookie_name,
        settings.csrf_cookie_name,
        settings.device_cookie_name,
    ):
        response.delete_cookie(name, path="/", domain=settings.cookie_domain)


async def get_current_context(
    request: Request,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    settings: SettingsDependency,
) -> AuthContext:
    return await service.authenticate_access(db, request.cookies.get(settings.access_cookie_name))


AuthContextDependency = Annotated[AuthContext, Depends(get_current_context)]


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="auth_register",
    responses={
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
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
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> AuthResponse:
    _require_trusted_origin(request, settings)
    subject = get_security().privacy_hash(_client_ip(request) or "unknown") or "unknown"
    await limiter.enforce(
        scope="register",
        subject_hash=subject,
        limit=settings.registration_limit_per_hour,
        window=3600,
    )
    issued = await service.register(
        db,
        payload,
        request_id=_request_id(request),
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
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
    _set_auth_cookies(response, issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(issued.user),
        session_expires_at=issued.session.access_expires_at,
    )


@router.post(
    "/login",
    response_model=AuthResponse,
    operation_id="auth_login",
    responses={
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
) -> AuthResponse:
    _require_trusted_origin(request, settings)
    await _enforce_login_rate_limits(
        limiter,
        settings,
        client_ip=_client_ip(request),
        normalized_email=normalize_email(str(payload.email)),
    )
    issued = await service.login(
        db,
        payload,
        request_id=_request_id(request),
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
        device_cookie=request.cookies.get(settings.device_cookie_name),
    )
    await db.commit()
    if issued is None:
        raise APIError(
            code="AUTH_INVALID_CREDENTIALS",
            message="The email or password is incorrect.",
            status_code=401,
        )
    _set_auth_cookies(response, issued, settings)
    return AuthResponse(
        user=UserResponse.model_validate(issued.user),
        session_expires_at=issued.session.access_expires_at,
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
    _require_trusted_origin(request, settings)
    outcome = await service.refresh(
        db,
        refresh_token=request.cookies.get(settings.refresh_cookie_name),
        csrf_header=x_csrf_token,
        csrf_cookie=request.cookies.get(settings.csrf_cookie_name),
        request_id=_request_id(request),
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
    _set_auth_cookies(response, outcome.issued, settings)
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
    _require_trusted_origin(request, settings)
    service.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    await service.logout(db, context, request_id=_request_id(request))
    await db.commit()
    _clear_auth_cookies(response, settings)
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
    _require_trusted_origin(request, settings)
    service.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    revoked_current = await service.revoke_device(
        db,
        context,
        device_id,
        request_id=_request_id(request),
    )
    await db.commit()
    if revoked_current:
        _clear_auth_cookies(response, settings)
    return MessageResponse()
