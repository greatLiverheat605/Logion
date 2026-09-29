from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response, status

from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import require_enabled
from logion_api.portability.dependencies import PortabilityServiceDependency
from logion_api.portability.research_export import RESEARCH_EXPORT_SCHEMA
from logion_api.portability.routes import ERROR, export_response, write_boundary
from logion_api.portability.schemas import ExportCancel, ExportCreate, ExportList, ExportResponse

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/research/data-exports",
    tags=["research-portability"],
    dependencies=[Depends(require_enabled)],
)


@router.post(
    "",
    response_model=ExportResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="research_data_export_create",
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
            db,
            context,
            workspace_id,
            payload.id,
            request_id(request),
            schema_version=RESEARCH_EXPORT_SCHEMA,
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return export_response(row)


@router.get(
    "",
    response_model=ExportList,
    operation_id="research_data_export_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_exports(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    portability: PortabilityServiceDependency,
) -> ExportList:
    rows = await portability.list_exports(
        db, context, workspace_id, request_id(request), schema_version=RESEARCH_EXPORT_SCHEMA
    )
    return ExportList(exports=[export_response(row) for row in rows])


@router.get(
    "/{export_id}/download",
    response_class=Response,
    operation_id="research_data_export_download",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 503: ERROR},
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
        db,
        context,
        workspace_id,
        export_id,
        request_id(request),
        schema_version=RESEARCH_EXPORT_SCHEMA,
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
    operation_id="research_data_export_cancel",
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
            schema_version=RESEARCH_EXPORT_SCHEMA,
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return export_response(row)
