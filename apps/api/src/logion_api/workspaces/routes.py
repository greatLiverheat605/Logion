from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.invitation_routes_support import workspace_response
from logion_api.workspaces.permissions import WorkspaceRole
from logion_api.workspaces.schemas import (
    SpaceCreateRequest,
    SpaceListResponse,
    SpaceResponse,
    WorkspaceCreateRequest,
    WorkspaceListResponse,
    WorkspaceMemberListResponse,
    WorkspaceMemberResponse,
    WorkspaceMemberUpdateRequest,
    WorkspaceResponse,
)
from logion_api.workspaces.service import WorkspaceMember

router = APIRouter(prefix="/api/v1/workspaces", tags=["workspaces"])

ERROR_RESPONSE = {"model": ErrorResponse}


def _csrf_cookie(request: Request, settings: SettingsDependency) -> str | None:
    return request.cookies.get(settings.csrf_cookie_name)


def _member_response(member: WorkspaceMember) -> WorkspaceMemberResponse:
    record = member.membership
    return WorkspaceMemberResponse.model_validate(
        {
            "id": record.id,
            "user_id": record.user_id,
            "email": member.user.email,
            "role": record.role,
            "status": record.status,
            "version": record.version,
            "joined_at": record.joined_at,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "revoked_at": record.revoked_at,
        }
    )


async def _enforce_creation_rate_limit(
    limiter: RateLimiterDependency,
    *,
    scope: str,
    identity: str,
    limit: int,
) -> None:
    subject_hash = get_security().privacy_hash(identity) or "unknown"
    await limiter.enforce(
        scope=scope,
        subject_hash=subject_hash,
        limit=limit,
        window=3600,
    )


@router.get(
    "",
    response_model=WorkspaceListResponse,
    operation_id="workspace_list",
    responses={401: ERROR_RESPONSE},
)
async def list_workspaces(
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> WorkspaceListResponse:
    accessible = await workspaces.list_workspaces(db, context)
    return WorkspaceListResponse(workspaces=[workspace_response(access) for access in accessible])


@router.post(
    "",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="workspace_create",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def create_workspace(
    payload: WorkspaceCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_creation_rate_limit(
        limiter,
        scope="workspace_create",
        identity=str(context.user.id),
        limit=settings.workspace_create_limit_per_hour,
    )
    try:
        access = await workspaces.create_workspace(
            db,
            context,
            payload.name,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return workspace_response(access)


@router.get(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    operation_id="workspace_get",
    responses={401: ERROR_RESPONSE, 404: ERROR_RESPONSE},
)
async def get_workspace(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> WorkspaceResponse:
    try:
        access = await workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id(request),
        )
    except APIError:
        await db.commit()
        raise
    return workspace_response(access)


@router.get(
    "/{workspace_id}/members",
    response_model=WorkspaceMemberListResponse,
    operation_id="workspace_member_list",
    responses={401: ERROR_RESPONSE, 403: ERROR_RESPONSE, 404: ERROR_RESPONSE},
)
async def list_workspace_members(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> WorkspaceMemberListResponse:
    try:
        members = await workspaces.list_members(
            db,
            context,
            workspace_id,
            request_id=request_id(request),
        )
    except APIError:
        await db.commit()
        raise
    return WorkspaceMemberListResponse(members=[_member_response(member) for member in members])


@router.post(
    "/{workspace_id}/members/{membership_id}/update",
    response_model=WorkspaceMemberResponse,
    operation_id="workspace_member_update",
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
async def update_workspace_member(
    workspace_id: UUID,
    membership_id: UUID,
    payload: WorkspaceMemberUpdateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceMemberResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_creation_rate_limit(
        limiter,
        scope="workspace_membership_change",
        identity=f"{workspace_id}:{context.user.id}",
        limit=settings.membership_change_limit_per_hour,
    )
    try:
        member = await workspaces.update_membership(
            db,
            context,
            workspace_id,
            membership_id,
            expected_version=payload.expected_version,
            role=WorkspaceRole(payload.role) if payload.role is not None else None,
            status=payload.status,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return _member_response(member)


@router.get(
    "/{workspace_id}/spaces",
    response_model=SpaceListResponse,
    operation_id="space_list",
    responses={401: ERROR_RESPONSE, 404: ERROR_RESPONSE},
)
async def list_spaces(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> SpaceListResponse:
    try:
        spaces = await workspaces.list_spaces(
            db,
            context,
            workspace_id,
            request_id=request_id(request),
        )
    except APIError:
        await db.commit()
        raise
    return SpaceListResponse(spaces=[SpaceResponse.model_validate(space) for space in spaces])


@router.post(
    "/{workspace_id}/spaces",
    response_model=SpaceResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="space_create",
    responses={
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        409: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
        503: ERROR_RESPONSE,
    },
)
async def create_space(
    workspace_id: UUID,
    payload: SpaceCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SpaceResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, x_csrf_token, _csrf_cookie(request, settings))
    identity.require_recent_authentication(context)
    await _enforce_creation_rate_limit(
        limiter,
        scope="space_create",
        identity=f"{workspace_id}:{context.user.id}",
        limit=settings.space_create_limit_per_hour,
    )
    try:
        space = await workspaces.create_space(
            db,
            context,
            workspace_id,
            name=payload.name,
            visibility=payload.visibility,
            request_id=request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return SpaceResponse.model_validate(space)


@router.get(
    "/{workspace_id}/spaces/{space_id}",
    response_model=SpaceResponse,
    operation_id="space_get",
    responses={401: ERROR_RESPONSE, 404: ERROR_RESPONSE},
)
async def get_space(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> SpaceResponse:
    try:
        space = await workspaces.resolve_space(
            db,
            context,
            workspace_id,
            space_id,
            request_id=request_id(request),
        )
    except APIError:
        await db.commit()
        raise
    return SpaceResponse.model_validate(space)
