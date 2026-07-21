from uuid import UUID

from fastapi import APIRouter, Header, Request

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
from logion_api.sync.push import SyncPushService
from logion_api.sync.schemas import PushRequest, PushResponse, RebootstrapControl
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/sync", tags=["sync"])


@router.post(
    "/push",
    response_model=PushResponse | RebootstrapControl,
    operation_id="sync_push",
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
)
async def push(
    workspace_id: UUID,
    payload: PushRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> PushResponse | RebootstrapControl:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    content_length = request.headers.get("content-length")
    if content_length is not None and content_length.isdecimal() and (
        int(content_length) > settings.sync_max_batch_bytes
    ):
        raise APIError(
            code="SYNC_BATCH_TOO_LARGE",
            message="The sync batch is too large.",
            status_code=413,
        )
    if len(payload.model_dump_json().encode()) > settings.sync_max_batch_bytes:
        raise APIError(
            code="SYNC_BATCH_TOO_LARGE",
            message="The sync batch is too large.",
            status_code=413,
        )
    if payload.workspace_id != workspace_id or payload.device_id != context.device.id:
        raise APIError(
            code="SYNC_CONTEXT_MISMATCH",
            message="The sync context is invalid.",
            status_code=403,
        )
    for operation in payload.operations:
        if operation.workspace_id != workspace_id or operation.device_id != context.device.id:
            raise APIError(
                code="SYNC_CONTEXT_MISMATCH",
                message="The sync context is invalid.",
                status_code=403,
            )
        if len(operation.model_dump_json().encode()) > settings.sync_max_operation_bytes:
            raise APIError(
                code="SYNC_OPERATION_TOO_LARGE",
                message="A sync operation is too large.",
                status_code=413,
            )
    await limiter.enforce(
        scope="sync_push",
        subject_hash=get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown",
        limit=settings.sync_push_limit_per_minute,
        window=60,
    )
    await workspaces.resolve_workspace(db, context, workspace_id, request_id=request_id(request))
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    if payload.sync_epoch != state.sync_epoch:
        server_sync_epoch = state.sync_epoch
        await db.rollback()
        return RebootstrapControl(server_sync_epoch=server_sync_epoch)
    results = await SyncPushService(SyncLedgerService(), workspaces).push(
        db,
        context,
        payload,
        request_id=request_id(request),
    )
    await db.commit()
    return PushResponse(
        workspace_id=workspace_id,
        device_id=context.device.id,
        sync_epoch=state.sync_epoch,
        results=results,
    )
