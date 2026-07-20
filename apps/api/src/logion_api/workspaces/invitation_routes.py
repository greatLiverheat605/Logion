from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    client_ip,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.workspaces.dependencies import WorkspaceInvitationServiceDependency
from logion_api.workspaces.invitation_routes_support import workspace_response
from logion_api.workspaces.schemas import (
    WorkspaceInvitationAcceptRequest,
    WorkspaceInvitationCreatedResponse,
    WorkspaceInvitationCreateRequest,
    WorkspaceInvitationResponse,
    WorkspaceResponse,
)

workspace_invitation_router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/invitations",
    tags=["workspace invitations"],
)
invitation_router = APIRouter(prefix="/api/v1/invitations", tags=["workspace invitations"])
ERROR_RESPONSE = {"model": ErrorResponse}


def _csrf_cookie(request: Request, settings: SettingsDependency) -> str | None:
    return request.cookies.get(settings.csrf_cookie_name)


async def _rate_limit(
    limiter: RateLimiterDependency,
    *,
    scope: str,
    identity: str,
    limit: int,
    window: int,
) -> None:
    await limiter.enforce(
        scope=scope,
        subject_hash=get_security().privacy_hash(identity) or "unknown",
        limit=limit,
        window=window,
    )


@workspace_invitation_router.post(
    "",
    response_model=WorkspaceInvitationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="workspace_invitation_create",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def create_workspace_invitation(
    workspace_id: UUID,
    payload: WorkspaceInvitationCreateRequest,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    invitations: WorkspaceInvitationServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceInvitationCreatedResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _rate_limit(
        limiter,
        scope="workspace_invitation_create",
        identity=f"{workspace_id}:{context.user.id}",
        limit=settings.invitation_create_limit_per_hour,
        window=3600,
    )
    try:
        issued = await invitations.create(
            db,
            context,
            workspace_id,
            email=payload.email,
            role=payload.role,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    response.headers["Cache-Control"] = "no-store"
    record = issued.invitation
    return WorkspaceInvitationCreatedResponse.model_validate(
        {
            "id": record.id,
            "workspace_id": record.workspace_id,
            "email": record.email_normalized,
            "role": record.role,
            "status": record.status,
            "expires_at": record.expires_at,
            "created_at": record.created_at,
            "token": issued.token,
        }
    )


@invitation_router.post(
    "/accept",
    response_model=WorkspaceResponse,
    operation_id="workspace_invitation_accept",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def accept_workspace_invitation(
    payload: WorkspaceInvitationAcceptRequest,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    invitations: WorkspaceInvitationServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _rate_limit(
        limiter,
        scope="workspace_invitation_accept_ip",
        identity=client_ip(request) or "unknown",
        limit=settings.invitation_accept_limit_per_five_minutes,
        window=300,
    )
    await _rate_limit(
        limiter,
        scope="workspace_invitation_accept_account",
        identity=str(context.user.id),
        limit=settings.invitation_accept_limit_per_five_minutes,
        window=300,
    )
    try:
        access = await invitations.accept(
            db,
            context,
            payload.token,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    response.headers["Cache-Control"] = "no-store"
    return workspace_response(access)


@workspace_invitation_router.delete(
    "/{invitation_id}",
    response_model=WorkspaceInvitationResponse,
    operation_id="workspace_invitation_revoke",
    responses={401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE, 422: ERROR_RESPONSE},
)
async def revoke_workspace_invitation(
    workspace_id: UUID,
    invitation_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    invitations: WorkspaceInvitationServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceInvitationResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    try:
        record = await invitations.revoke(
            db,
            context,
            workspace_id,
            invitation_id,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return WorkspaceInvitationResponse.model_validate(
        {
            "id": record.id,
            "workspace_id": record.workspace_id,
            "email": record.email_normalized,
            "role": record.role,
            "status": record.status,
            "expires_at": record.expires_at,
            "created_at": record.created_at,
        }
    )
