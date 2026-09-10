from uuid import UUID

from fastapi import APIRouter, Header, Request

from logion_api.collaboration.dependencies import CollaborationServiceDependency
from logion_api.content.dependencies import ContentServiceDependency
from logion_api.errors import APIError, ErrorResponse
from logion_api.exam.dependencies import ExamServiceDependency
from logion_api.execution.dependencies import ExecutionServiceDependency
from logion_api.execution.evidence_dependencies import EvidenceServiceDependency
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
from logion_api.memory.dependencies import MemoryServiceDependency
from logion_api.planning.dependencies import PlanningServiceDependency
from logion_api.research.dependencies import ResearchServiceDependency
from logion_api.self_study.dependencies import SelfStudyServiceDependency
from logion_api.sync.deletion import DeleteEntityType, deletion_scope
from logion_api.sync.push import SyncPushService
from logion_api.sync.read import InvalidChunkError, StaleSnapshotError, SyncReadService
from logion_api.sync.schemas import (
    AppliedOperationResult,
    BootstrapRequest,
    BootstrapResponse,
    ConflictOperationResult,
    CursorExpiredControl,
    DeletionPreview,
    FailedOperationResult,
    PullRequest,
    PullResponse,
    PushRequest,
    PushResponse,
    RebootstrapControl,
    UpgradeControl,
)
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/sync", tags=["sync"])

DELETION_CAPABILITY = "entity-deletion-v1"


def _supports_deletion(capabilities: str | None) -> bool:
    return capabilities is not None and DELETION_CAPABILITY in {
        item.strip() for item in capabilities.split(",")
    }


@router.get(
    "/deletion-preview/{entity_type}/{entity_id}",
    response_model=DeletionPreview,
    operation_id="sync_deletion_preview",
)
async def preview_deletion(
    workspace_id: UUID,
    entity_type: DeleteEntityType,
    entity_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> DeletionPreview:
    scope = await deletion_scope(
        db, workspaces, context, workspace_id, entity_type, entity_id, request_id(request)
    )
    return DeletionPreview(
        server_version=scope.root.version,
        impact=scope.impact,
        blockers=scope.blockers,
        can_delete=scope.root.deleted_at is None and not any(scope.blockers.values()),
    )


def _validate_context(
    workspace_id: UUID,
    envelope_workspace_id: UUID,
    envelope_device_id: UUID,
    context: AuthContextDependency,
) -> None:
    if envelope_workspace_id != workspace_id or envelope_device_id != context.device.id:
        raise APIError(
            code="SYNC_CONTEXT_MISMATCH",
            message="The sync context is invalid.",
            status_code=403,
        )


@router.post(
    "/push",
    response_model=PushResponse | RebootstrapControl | UpgradeControl,
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
    planning: PlanningServiceDependency,
    execution: ExecutionServiceDependency,
    content: ContentServiceDependency,
    evidence: EvidenceServiceDependency,
    memory: MemoryServiceDependency,
    exams: ExamServiceDependency,
    self_study: SelfStudyServiceDependency,
    research: ResearchServiceDependency,
    collaboration: CollaborationServiceDependency,
    x_csrf_token: str | None = Header(default=None),
    x_logion_sync_capabilities: str | None = Header(default=None, max_length=256),
) -> PushResponse | RebootstrapControl | UpgradeControl:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    content_length = request.headers.get("content-length")
    if (
        content_length is not None
        and content_length.isdecimal()
        and (int(content_length) > settings.sync_max_batch_bytes)
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
    _validate_context(workspace_id, payload.workspace_id, payload.device_id, context)
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
    if not _supports_deletion(x_logion_sync_capabilities) and any(
        operation.operation_type == "delete" for operation in payload.operations
    ):
        await db.rollback()
        return UpgradeControl(server_sync_epoch=payload.sync_epoch)
    results = await SyncPushService(
        SyncLedgerService(),
        workspaces,
        planning,
        execution,
        content,
        evidence,
        memory,
        exams,
        self_study,
        research,
        collaboration,
    ).push(
        db,
        context,
        payload,
        request_id=request_id(request),
    )
    if not _supports_deletion(x_logion_sync_capabilities) and any(
        (
            isinstance(result, ConflictOperationResult)
            and (
                result.conflict.conflict_kind == "delete_update"
                or result.conflict.remote_deleted_at is not None
            )
        )
        or (isinstance(result, AppliedOperationResult) and result.impact is not None)
        or (isinstance(result, FailedOperationResult) and result.details is not None)
        for result in results
    ):
        # The control acknowledges nothing: roll back the entire batch, including
        # earlier successful operations and newly recorded conflicts.
        await db.rollback()
        return UpgradeControl(server_sync_epoch=payload.sync_epoch)
    await db.commit()
    return PushResponse(
        workspace_id=workspace_id,
        device_id=context.device.id,
        sync_epoch=payload.sync_epoch,
        results=results,
    )


@router.post(
    "/pull",
    response_model=PullResponse | RebootstrapControl | CursorExpiredControl | UpgradeControl,
    operation_id="sync_pull",
)
async def pull(
    workspace_id: UUID,
    payload: PullRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    settings: SettingsDependency,
    x_logion_sync_capabilities: str | None = Header(default=None, max_length=256),
) -> PullResponse | RebootstrapControl | CursorExpiredControl | UpgradeControl:
    require_trusted_origin(request, settings)
    _validate_context(workspace_id, payload.workspace_id, payload.device_id, context)
    await workspaces.resolve_workspace(db, context, workspace_id, request_id=request_id(request))
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    if payload.sync_epoch != state.sync_epoch:
        return RebootstrapControl(server_sync_epoch=state.sync_epoch)
    if payload.cursor < state.min_retained_sequence:
        return CursorExpiredControl(server_sync_epoch=state.sync_epoch)
    response = await SyncReadService().pull(
        db,
        state,
        device_id=context.device.id,
        user_id=context.user.id,
        cursor=payload.cursor,
        limit=payload.limit,
    )
    # Inspect only authorized changes; private tombstones cannot trigger a control.
    if not _supports_deletion(x_logion_sync_capabilities) and any(
        change.tombstone or change.deleted_at is not None or change.operation_type == "delete"
        for change in response.changes
    ):
        return UpgradeControl(server_sync_epoch=payload.sync_epoch)
    return response


@router.post(
    "/bootstrap",
    response_model=BootstrapResponse | UpgradeControl,
    operation_id="sync_bootstrap",
)
async def bootstrap(
    workspace_id: UUID,
    payload: BootstrapRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    settings: SettingsDependency,
    x_logion_sync_capabilities: str | None = Header(default=None, max_length=256),
) -> BootstrapResponse | UpgradeControl:
    require_trusted_origin(request, settings)
    _validate_context(workspace_id, payload.workspace_id, payload.device_id, context)
    await workspaces.resolve_workspace(db, context, workspace_id, request_id=request_id(request))
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    # Legacy pages retry bootstrap after upgrade_required. Replacing an existing
    # snapshot can overwrite pending encrypted edits before Outbox reconciliation.
    if (
        payload.known_sync_epoch is not None
        and (payload.snapshot_id is None or payload.chunk_index in (None, 0))
        and not _supports_deletion(x_logion_sync_capabilities)
    ):
        return UpgradeControl(server_sync_epoch=state.sync_epoch)
    try:
        response = await SyncReadService().bootstrap(
            db,
            state,
            device_id=context.device.id,
            user_id=context.user.id,
            requested_snapshot_id=payload.snapshot_id,
            chunk_index=payload.chunk_index,
        )
    except StaleSnapshotError as exc:
        raise APIError(
            code="SYNC_SNAPSHOT_STALE",
            message="The snapshot changed; restart bootstrap.",
            status_code=409,
            retryable=True,
        ) from exc
    except InvalidChunkError as exc:
        raise APIError(
            code="SYNC_SNAPSHOT_CHUNK_INVALID",
            message="The snapshot chunk does not exist.",
            status_code=422,
        ) from exc
    await db.commit()
    return response
