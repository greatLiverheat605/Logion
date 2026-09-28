from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from logion_api.db import utc_now
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
from logion_api.library.schemas import (
    LibraryCreate,
    LibraryDelete,
    LibraryPage,
    LibraryResource,
    LibraryUpdate,
    ReadingProgressUpdate,
    ReadingStatus,
)
from logion_api.library.service import LibraryService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def require_enabled(settings: SettingsDependency, response: Response) -> None:
    if not settings.research_v3_enabled:
        raise APIError(code="NOT_FOUND", message="Not found.", status_code=404)
    response.headers["Cache-Control"] = "private, no-store"


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources",
    tags=["research-library"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


def get_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> LibraryService:
    return LibraryService(settings, workspaces)


Service = Annotated[LibraryService, Depends(get_service)]


async def write_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session, x_csrf_token, request.cookies.get(settings.csrf_cookie_name)
    )
    subject = get_security().privacy_hash(str(context.user.id)) or "unknown"
    await limiter.enforce(
        scope="research_library_write",
        subject_hash=subject,
        limit=settings.research_write_limit_per_hour,
        window=3600,
    )


@router.get("", response_model=LibraryPage, operation_id="research_library_list")
async def list_resources(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    status: ReadingStatus | None = None,
    tag: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> LibraryPage:
    rows, next_cursor = await service.list(
        db,
        context,
        workspace_id,
        space_id,
        request_id(request),
        status=status,
        tag=tag,
        cursor=cursor,
        limit=limit,
    )
    return LibraryPage(
        resources=[LibraryResource.model_validate(row) for row in rows],
        next_cursor=next_cursor,
    )


@router.get("/{resource_id}", response_model=LibraryResource, operation_id="research_library_get")
async def get_resource(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> LibraryResource:
    item = await service.get(db, context, workspace_id, space_id, resource_id, request_id(request))
    return LibraryResource.model_validate(item)


@router.post(
    "",
    response_model=LibraryResource,
    status_code=201,
    operation_id="research_library_create",
    dependencies=[Depends(write_boundary)],
)
async def create_resource(
    workspace_id: UUID,
    space_id: UUID,
    payload: LibraryCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> LibraryResource:
    try:
        item = await service.create(
            db, context, workspace_id, space_id, payload, request_id(request)
        )
        result = LibraryResource.model_validate(item)
        await db.commit()
        return result
    except Exception:
        await db.rollback()
        raise


@router.put(
    "/{resource_id}",
    response_model=LibraryResource,
    operation_id="research_library_update",
    dependencies=[Depends(write_boundary)],
)
async def update_resource(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: LibraryUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> LibraryResource:
    try:
        item = await service.update(
            db, context, workspace_id, space_id, resource_id, payload, request_id(request)
        )
        result = LibraryResource.model_validate(item)
        await db.commit()
        return result
    except Exception:
        await db.rollback()
        raise


@router.patch(
    "/{resource_id}/reading-status",
    response_model=LibraryResource,
    operation_id="research_reading_status_update",
    dependencies=[Depends(write_boundary)],
)
async def update_reading_status(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: ReadingProgressUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> LibraryResource:
    item = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    service.check_version(item, payload.expected_version)
    if item.reading_status == "archived" or (
        payload.status == "close_read" and item.reading_status not in {"reading", "close_read"}
    ):
        raise APIError(
            code="READING_TRANSITION_INVALID",
            message="Start reading before completing; archived sources stay archived.",
            status_code=409,
        )
    if item.reading_status != payload.status:
        item.reading_status = payload.status
        item.updated_at = utc_now()
        item.updated_by = context.user.id
        item.version += 1
        if payload.status == "close_read":
            item.read_at = item.updated_at
        service.audit(db, context, request_id(request), "reading_status_updated")
        await db.flush()
    result = LibraryResource.model_validate(item)
    await db.commit()
    return result


@router.delete(
    "/{resource_id}",
    status_code=204,
    operation_id="research_library_delete",
    dependencies=[Depends(write_boundary)],
)
async def delete_resource(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: LibraryDelete,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> Response:
    try:
        await service.delete(
            db,
            context,
            workspace_id,
            space_id,
            resource_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})
