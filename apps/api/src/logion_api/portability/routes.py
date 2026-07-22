from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    DeletionAuthContextDependency,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    clear_auth_cookies,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.portability.dependencies import (
    AccountDeletionServiceDependency,
    ImportServiceDependency,
    PortabilityServiceDependency,
)
from logion_api.portability.models import AccountDeletionRequest, DataExportJob, DataImportPreview
from logion_api.portability.schemas import (
    AccountDeletionCancel,
    AccountDeletionCreate,
    AccountDeletionResponse,
    ExportCancel,
    ExportCreate,
    ExportList,
    ExportResponse,
    ImportCommit,
    ImportPreviewCreate,
    ImportPreviewList,
    ImportPreviewResponse,
)

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/data-exports", tags=["portability"])
import_router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/data-imports", tags=["portability"]
)
account_router = APIRouter(prefix="/api/v1/account-deletion", tags=["portability"])
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


def import_response(row: DataImportPreview) -> ImportPreviewResponse:
    return ImportPreviewResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        source_format=row.source_format,
        source_filename=row.source_filename,
        source_sha256=row.source_sha256,
        counts=row.counts,
        warnings=row.warnings,
        status=row.status,
        imported_space_id=row.imported_space_id,
        version=row.version,
        created_at=row.created_at,
        imported_at=row.imported_at,
        expires_at=row.expires_at,
    )


def deletion_response(row: AccountDeletionRequest) -> AccountDeletionResponse:
    return AccountDeletionResponse(
        id=row.id,
        status=row.status,
        owned_workspace_ids=[UUID(value) for value in row.owned_workspace_ids],
        policy_version=row.policy_version,
        version=row.version,
        requested_at=row.requested_at,
        delete_after=row.delete_after,
        cancelled_at=row.cancelled_at,
        completed_at=row.completed_at,
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


@import_router.post(
    "/preview",
    response_model=ImportPreviewResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="data_import_preview",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def preview_import(
    workspace_id: UUID,
    payload: ImportPreviewCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    imports: ImportServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ImportPreviewResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await imports.preview(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return import_response(row)


@import_router.get(
    "",
    response_model=ImportPreviewList,
    operation_id="data_import_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_imports(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    imports: ImportServiceDependency,
) -> ImportPreviewList:
    rows = await imports.list_previews(db, context, workspace_id, request_id(request))
    return ImportPreviewList(imports=[import_response(row) for row in rows])


@import_router.post(
    "/{preview_id}/commit",
    response_model=ImportPreviewResponse,
    operation_id="data_import_commit",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def commit_import(
    workspace_id: UUID,
    preview_id: UUID,
    payload: ImportCommit,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    imports: ImportServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ImportPreviewResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await imports.commit(
            db,
            context,
            workspace_id,
            preview_id,
            payload.target_space_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return import_response(row)


async def account_write_boundary(
    request: Request,
    context: AuthContextDependency | DeletionAuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    csrf: str | None,
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, csrf, request.cookies.get(settings.csrf_cookie_name))
    identity.require_recent_authentication(context)
    subject = get_security().privacy_hash(str(context.user.id)) or "unknown"
    await limiter.enforce(
        scope="account_deletion_write",
        subject_hash=subject,
        limit=settings.data_portability_write_limit_per_hour,
        window=3600,
    )


@account_router.post(
    "",
    response_model=AccountDeletionResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="account_deletion_request",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def request_account_deletion(
    payload: AccountDeletionCreate,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    deletion: AccountDeletionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AccountDeletionResponse:
    await account_write_boundary(request, context, identity, limiter, settings, x_csrf_token)
    try:
        row = await deletion.request(db, context, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    clear_auth_cookies(response, settings)
    return deletion_response(row)


@account_router.get(
    "",
    response_model=AccountDeletionResponse,
    operation_id="account_deletion_status",
    responses={401: ERROR, 404: ERROR},
)
async def account_deletion_status(
    context: DeletionAuthContextDependency,
    db: DatabaseSession,
    deletion: AccountDeletionServiceDependency,
) -> AccountDeletionResponse:
    return deletion_response(await deletion.get_pending(db, context))


@account_router.post(
    "/cancel",
    response_model=AccountDeletionResponse,
    operation_id="account_deletion_cancel",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def cancel_account_deletion(
    payload: AccountDeletionCancel,
    request: Request,
    context: DeletionAuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    deletion: AccountDeletionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AccountDeletionResponse:
    await account_write_boundary(request, context, identity, limiter, settings, x_csrf_token)
    try:
        row = await deletion.cancel(db, context, payload.expected_version, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return deletion_response(row)
