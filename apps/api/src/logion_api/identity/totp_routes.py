from fastapi import APIRouter, Header, Request, Response, status

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    TotpServiceDependency,
    client_ip,
    get_security,
    request_id,
    require_trusted_origin,
    set_auth_cookies,
)
from logion_api.identity.schemas import (
    AuthResponse,
    MessageResponse,
    MfaLoginVerifyRequest,
    RecoveryCodesResponse,
    TotpActivationResponse,
    TotpCodeRequest,
    TotpEnrollmentResponse,
    TotpStatusResponse,
    UserResponse,
)

router = APIRouter(prefix="/api/v1/auth/totp", tags=["identity"])

ERROR_RESPONSE = {"model": ErrorResponse}


def _csrf_cookie(request: Request, settings: SettingsDependency) -> str | None:
    return request.cookies.get(settings.csrf_cookie_name)


async def _enforce_totp_rate_limit(
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
        limit=settings.totp_limit_per_five_minutes,
        window=300,
    )


@router.post(
    "/enrollment",
    response_model=TotpEnrollmentResponse,
    operation_id="auth_totp_enrollment_start",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def start_enrollment(
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    totp: TotpServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TotpEnrollmentResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_totp_rate_limit(
        limiter,
        settings,
        scope="totp_enrollment_start",
        identity=str(context.user.id),
    )
    enrollment = await totp.start_enrollment(
        db,
        context,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "no-store"
    return TotpEnrollmentResponse(
        secret=enrollment.secret,
        provisioning_uri=enrollment.provisioning_uri,
        expires_at=enrollment.expires_at,
    )


@router.post(
    "/enrollment/verify",
    response_model=TotpActivationResponse,
    operation_id="auth_totp_enrollment_verify",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def verify_enrollment(
    payload: TotpCodeRequest,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    totp: TotpServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TotpActivationResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_totp_rate_limit(
        limiter,
        settings,
        scope="totp_enrollment_verify",
        identity=str(context.user.id),
    )
    try:
        activation = await totp.activate(
            db,
            context,
            payload.code,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    response.headers["Cache-Control"] = "no-store"
    return TotpActivationResponse(
        verified_at=activation.verified_at,
        recovery_codes=activation.recovery_codes,
    )


@router.post(
    "/login/verify",
    response_model=AuthResponse,
    operation_id="auth_totp_login_verify",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def verify_login(
    payload: MfaLoginVerifyRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    totp: TotpServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> AuthResponse:
    require_trusted_origin(request, settings)
    await _enforce_totp_rate_limit(
        limiter,
        settings,
        scope="totp_login_verify",
        identity=f"{client_ip(request) or 'unknown'}:{payload.challenge_token}",
    )
    try:
        verified = await totp.verify_login(
            db,
            payload.challenge_token,
            payload.code,
            payload.method,
            request_id=request_id(request),
        )
        device = await identity.find_reusable_device(
            db,
            verified.user.id,
            request.cookies.get(settings.device_cookie_name),
        )
        issued = await identity.issue_session(
            db,
            user=verified.user,
            device=device,
            device_name=verified.challenge.device_name,
            platform=verified.challenge.platform,
            request_id=request_id(request),
            ip_address=client_ip(request),
            user_agent=request.headers.get("user-agent"),
            event_type="identity.login_succeeded",
            event_metadata={"mfa_method": verified.method},
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
    response_model=TotpStatusResponse,
    operation_id="auth_totp_status",
    responses={401: ERROR_RESPONSE},
)
async def get_totp_status(
    context: AuthContextDependency,
    db: DatabaseSession,
    totp: TotpServiceDependency,
) -> TotpStatusResponse:
    enabled, remaining = await totp.status(db, context)
    return TotpStatusResponse(enabled=enabled, recovery_codes_remaining=remaining)


@router.post(
    "/recovery-codes/regenerate",
    response_model=RecoveryCodesResponse,
    operation_id="auth_totp_recovery_codes_regenerate",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def regenerate_recovery_codes(
    payload: TotpCodeRequest,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    totp: TotpServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> RecoveryCodesResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_totp_rate_limit(
        limiter,
        settings,
        scope="totp_recovery_codes_regenerate",
        identity=str(context.user.id),
    )
    try:
        codes = await totp.regenerate_recovery_codes(
            db,
            context,
            payload.code,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    response.headers["Cache-Control"] = "no-store"
    return RecoveryCodesResponse(recovery_codes=codes)


@router.delete(
    "",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    operation_id="auth_totp_disable",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def disable_totp(
    payload: TotpCodeRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    totp: TotpServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MessageResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_totp_rate_limit(
        limiter,
        settings,
        scope="totp_disable",
        identity=str(context.user.id),
    )
    try:
        await totp.disable(
            db,
            context,
            payload.code,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return MessageResponse()
