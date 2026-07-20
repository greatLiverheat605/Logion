from typing import Protocol

from fastapi import APIRouter, Request, Response, status

from logion_api.errors import ErrorResponse
from logion_api.identity.dependencies import (
    DatabaseSession,
    EmailVerificationServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    client_ip,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.identity.schemas import (
    EmailVerificationConfirmationRequest,
    MessageResponse,
    RegistrationStartRequest,
)
from logion_api.identity.service import normalize_email
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

router = APIRouter(prefix="/api/v1/auth", tags=["identity"])
ERROR_RESPONSE = {"model": ErrorResponse}


class RateLimitEnforcer(Protocol):
    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None: ...


async def _enforce_registration_rate_limits(
    limiter: RateLimitEnforcer,
    settings: SettingsDependency,
    *,
    client_ip_value: str | None,
    normalized_email: str,
) -> None:
    security = get_security()
    subjects = (
        (
            "email_registration_ip",
            client_ip_value or "unknown",
            settings.email_registration_ip_limit_per_hour,
        ),
        (
            "email_registration_account",
            normalized_email,
            settings.email_registration_account_limit_per_hour,
        ),
    )
    for scope, identity, limit in subjects:
        await limiter.enforce(
            scope=scope,
            subject_hash=security.privacy_hash(identity) or "unknown",
            limit=limit,
            window=3600,
        )


@router.post(
    "/registrations",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="auth_registration_start",
    responses={
        403: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def start_registration(
    payload: RegistrationStartRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    service: EmailVerificationServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> MessageResponse:
    require_trusted_origin(request, settings)
    email = str(payload.email)
    await _enforce_registration_rate_limits(
        limiter,
        settings,
        client_ip_value=client_ip(request),
        normalized_email=normalize_email(email),
    )
    await service.start_registration(db, email, request_id=request_id(request))
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return MessageResponse()


@router.post(
    "/email-verification/confirmations",
    response_model=MessageResponse,
    operation_id="auth_email_verification_confirm",
    responses={
        400: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def confirm_email_verification(
    payload: EmailVerificationConfirmationRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    service: EmailVerificationServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> MessageResponse:
    require_trusted_origin(request, settings)
    await limiter.enforce(
        scope="email_verification_confirm_ip",
        subject_hash=get_security().privacy_hash(client_ip(request) or "unknown") or "unknown",
        limit=settings.email_verification_confirm_limit_per_five_minutes,
        window=300,
    )
    user = await service.confirm(
        db,
        payload.token,
        payload.password,
        request_id=request_id(request),
    )
    await workspaces.provision_personal_workspace(
        db,
        user.id,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return MessageResponse()
