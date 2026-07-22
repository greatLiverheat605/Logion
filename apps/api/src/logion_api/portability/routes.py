from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

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
from logion_api.portability.dependencies import PortabilityServiceDependency
from logion_api.portability.models import DataExportJob
from logion_api.portability.schemas import ExportCancel, ExportCreate, ExportList, ExportResponse

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/data-exports", tags=["portability"])
ERROR = {"model": ErrorResponse}


def export_response(row: DataExportJob) -> ExportResponse:
    return ExportResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        status=row.status,
        schema_version=row.schema_version,
        artifact_sha256=row.artifact_sha256,
        artifact_bytes=row.artifact_bytes,
        error_code=row.error_code,
        version=row.version,
        created_at=row.created_at,
        completed_at=row.completed_at,
        expires_at=row.expires_at,
    )


async def write_boundary(
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
        scope="data_portability_write",
        subject_hash=subject,
        limit=settings.data_portability_write_limit_per_hour,
        window=3600,
    )


@router.post(
    "",
    response_model=ExportResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="data_export_create",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_export(
    workspace_id: UUID,
    payload: ExportCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    portability: PortabilityServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ExportResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await portability.create_export(
            db, context, workspace_id, payload.id, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return export_response(row)


@router.get(
    "",
    response_model=ExportList,
    operation_id="data_export_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_exports(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    portability: PortabilityServiceDependency,
) -> ExportList:
    rows = await portability.list_exports(db, context, workspace_id, request_id(request))
    return ExportList(exports=[export_response(row) for row in rows])


@router.get(
    "/{export_id}/download",
    response_class=Response,
    operation_id="data_export_download",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 503: ERROR},
)
async def download_export(
    workspace_id: UUID,
    export_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    portability: PortabilityServiceDependency,
) -> Response:
    identity.require_recent_authentication(context)
    row, value = await portability.get_artifact(
        db, context, workspace_id, export_id, request_id(request)
    )
    return Response(
        content=value,
        media_type="application/zip",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'attachment; filename="logion-export-{row.id}.zip"',
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/{export_id}/cancel",
    response_model=ExportResponse,
    operation_id="data_export_cancel",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def cancel_export(
    workspace_id: UUID,
    export_id: UUID,
    payload: ExportCancel,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    portability: PortabilityServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ExportResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await portability.cancel_export(
            db,
            context,
            workspace_id,
            export_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return export_response(row)
