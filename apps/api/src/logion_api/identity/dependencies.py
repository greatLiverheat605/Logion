from functools import lru_cache
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings, get_settings
from logion_api.db import get_session
from logion_api.errors import APIError
from logion_api.identity.email_verification import EmailVerificationService
from logion_api.identity.passkeys import PasskeyService
from logion_api.identity.rate_limit import RateLimiter
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, IdentityService, IssuedSession
from logion_api.identity.totp import TotpService


@lru_cache
def get_security() -> IdentitySecurity:
    return IdentitySecurity(get_settings().secret_key.get_secret_value())


def get_identity_service() -> IdentityService:
    return IdentityService(get_settings(), get_security())


def get_rate_limiter() -> RateLimiter:
    return RateLimiter(get_settings().redis_url)


def get_passkey_service() -> PasskeyService:
    return PasskeyService(get_settings(), get_security())


def get_totp_service() -> TotpService:
    return TotpService(get_settings(), get_security())


def get_email_verification_service() -> EmailVerificationService:
    return EmailVerificationService(get_settings(), get_security())


DatabaseSession = Annotated[AsyncSession, Depends(get_session)]
IdentityServiceDependency = Annotated[IdentityService, Depends(get_identity_service)]
RateLimiterDependency = Annotated[RateLimiter, Depends(get_rate_limiter)]
PasskeyServiceDependency = Annotated[PasskeyService, Depends(get_passkey_service)]
TotpServiceDependency = Annotated[TotpService, Depends(get_totp_service)]
EmailVerificationServiceDependency = Annotated[
    EmailVerificationService,
    Depends(get_email_verification_service),
]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def request_id(request: Request) -> str:
    return str(request.state.request_id)


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def require_trusted_origin(request: Request, settings: Settings) -> None:
    origin = request.headers.get("origin")
    if origin is None and not settings.require_origin_header:
        return
    if origin not in settings.allowed_origins:
        raise APIError(
            code="AUTH_ORIGIN_INVALID",
            message="The request origin is not allowed.",
            status_code=403,
        )


def require_webauthn_origin(request: Request, settings: Settings) -> str:
    origin = request.headers.get("origin")
    if origin not in settings.webauthn_origins:
        raise APIError(
            code="AUTH_ORIGIN_INVALID",
            message="The request origin is not allowed for Passkey authentication.",
            status_code=403,
        )
    return origin


def set_auth_cookies(response: Response, issued: IssuedSession, settings: Settings) -> None:
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


def clear_auth_cookies(response: Response, settings: Settings) -> None:
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


async def get_deletion_context(
    request: Request,
    db: DatabaseSession,
    service: IdentityServiceDependency,
    settings: SettingsDependency,
) -> AuthContext:
    return await service.authenticate_deletion_access(
        db, request.cookies.get(settings.access_cookie_name)
    )


AuthContextDependency = Annotated[AuthContext, Depends(get_current_context)]
DeletionAuthContextDependency = Annotated[AuthContext, Depends(get_deletion_context)]
