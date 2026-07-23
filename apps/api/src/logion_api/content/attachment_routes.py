from typing import cast
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status
from fastapi.responses import FileResponse

from logion_api.content.attachment_dependencies import AttachmentServiceDependency
from logion_api.content.attachment_schemas import (
    AttachmentComplete,
    AttachmentInit,
    AttachmentResponse,
    AttachmentStatus,
    AttachmentTargetType,
)
from logion_api.content.models import Attachment
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

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/attachments",
    tags=["attachments"],
)
ERROR = {"model": ErrorResponse}


def attachment_response(row: Attachment) -> AttachmentResponse:
    return AttachmentResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        space_id=row.space_id,
        target_type=cast(AttachmentTargetType, row.target_type),
        target_id=row.target_id,
        filename=row.filename,
        declared_mime=row.declared_mime,
        detected_mime=row.detected_mime,
        size_bytes=row.size_bytes,
        expected_sha256=row.expected_sha256,
        verified_sha256=row.verified_sha256,
        status=cast(AttachmentStatus, row.status),
        failure_code=row.failure_code,
        version=row.version,
        created_at=row.created_at,
        updated_at=row.updated_at,
        verified_at=row.verified_at,
    )


async def attachment_write_boundary(
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
    identity.require_recent_authentication(context)
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="attachment_write",
        subject_hash=subject,
        limit=settings.attachment_write_limit_per_hour,
        window=3600,
    )


@router.post(
    "/init",
    response_model=AttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="attachment_init",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 413: ERROR, 422: ERROR, 429: ERROR},
)
async def initiate_attachment(
    workspace_id: UUID,
    space_id: UUID,
    payload: AttachmentInit,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    attachments: AttachmentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AttachmentResponse:
    await attachment_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        row = await attachments.initiate(
            db, context, workspace_id, space_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return attachment_response(row)


@router.put(
    "/{attachment_id}/content",
    response_model=AttachmentResponse,
    operation_id="attachment_upload_content",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 413: ERROR, 422: ERROR, 429: ERROR},
)
async def upload_attachment_content(
    workspace_id: UUID,
    space_id: UUID,
    attachment_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    attachments: AttachmentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AttachmentResponse:
    await attachment_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    if request.headers.get("content-type", "").split(";", 1)[0].strip().casefold() != (
        "application/octet-stream"
    ):
        raise APIError(
            code="ATTACHMENT_CONTENT_TYPE_INVALID",
            message="Attachment upload requires application/octet-stream.",
            status_code=415,
        )
    try:
        row = await attachments.upload(
            db,
            context,
            workspace_id,
            space_id,
            attachment_id,
            request.stream(),
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return attachment_response(row)


@router.post(
    "/{attachment_id}/complete",
    response_model=AttachmentResponse,
    operation_id="attachment_complete",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def complete_attachment(
    workspace_id: UUID,
    space_id: UUID,
    attachment_id: UUID,
    payload: AttachmentComplete,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    attachments: AttachmentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AttachmentResponse:
    await attachment_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        row = await attachments.complete(
            db,
            context,
            workspace_id,
            space_id,
            attachment_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
        await attachments.cleanup_staging(row)
    except APIError:
        await db.commit()
        raise
    return attachment_response(row)


@router.get(
    "/{attachment_id}/content",
    operation_id="attachment_download_content",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 503: ERROR},
)
async def download_attachment_content(
    workspace_id: UUID,
    space_id: UUID,
    attachment_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    attachments: AttachmentServiceDependency,
) -> Response:
    row, raw_path = await attachments.download_path(
        db, context, workspace_id, space_id, attachment_id, request_id(request)
    )
    response = FileResponse(
        raw_path,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
        },
    )
    return response
