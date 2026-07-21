from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.content.dependencies import ContentServiceDependency
from logion_api.content.models import Note, Resource
from logion_api.content.schemas import (
    NoteResponse,
    NoteUpdateRequest,
    NoteWriteRequest,
    PageIndexEntry,
    ResourceCreateRequest,
    ResourceResponse,
    ResourceUpdateRequest,
)
from logion_api.errors import ErrorResponse
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}", tags=["content"])
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


async def boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    csrf: str | None,
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, csrf, request.cookies.get(settings.csrf_cookie_name))
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="content_write",
        subject_hash=subject,
        limit=settings.content_write_limit_per_hour,
        window=3600,
    )


def note_response(note: Note) -> NoteResponse:
    return NoteResponse(
        id=note.id,
        workspace_id=note.workspace_id,
        space_id=note.space_id,
        task_id=note.task_id,
        title=note.title,
        markdown_body=note.markdown_body,
        version=note.version,
    )


def resource_response(resource: Resource) -> ResourceResponse:
    return ResourceResponse(
        id=resource.id,
        workspace_id=resource.workspace_id,
        space_id=resource.space_id,
        task_id=resource.task_id,
        resource_type=cast(Any, resource.resource_type),
        title=resource.title,
        source_url=resource.source_url,
        pdf_filename=resource.pdf_filename,
        page_count=resource.page_count,
        sha256=resource.sha256,
        page_index=[PageIndexEntry.model_validate(item) for item in resource.page_index],
        version=resource.version,
    )


@router.post(
    "/notes",
    response_model=NoteResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="note_create",
    responses=ERRORS,
)
async def create_note(
    workspace_id: UUID,
    space_id: UUID,
    payload: NoteWriteRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    content: ContentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> NoteResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    note = await content.create_note(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return note_response(note)


@router.put(
    "/notes/{note_id}", response_model=NoteResponse, operation_id="note_update", responses=ERRORS
)
async def update_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    payload: NoteUpdateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    content: ContentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> NoteResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    note = await content.update_note(
        db, context, workspace_id, space_id, note_id, payload, request_id(request)
    )
    await db.commit()
    return note_response(note)


@router.post(
    "/resources",
    response_model=ResourceResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="resource_create",
    responses=ERRORS,
)
async def create_resource(
    workspace_id: UUID,
    space_id: UUID,
    payload: ResourceCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    content: ContentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ResourceResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    resource = await content.create_resource(
        db, context, workspace_id, space_id, payload.id, payload, request_id(request)
    )
    await db.commit()
    return resource_response(resource)


@router.put(
    "/resources/{resource_id}",
    response_model=ResourceResponse,
    operation_id="resource_update",
    responses=ERRORS,
)
async def update_resource(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: ResourceUpdateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    content: ContentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ResourceResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    resource = await content.update_resource(
        db,
        context,
        workspace_id,
        space_id,
        resource_id,
        payload.expected_version,
        payload,
        request_id(request),
    )
    await db.commit()
    return resource_response(resource)
