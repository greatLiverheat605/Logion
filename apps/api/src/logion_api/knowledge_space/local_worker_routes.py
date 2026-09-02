from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response, status

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
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.dependencies import LocalWorkerServiceDependency
from logion_api.knowledge_space.errors import (
    local_worker_disabled_error,
    local_worker_token_invalid_error,
)
from logion_api.knowledge_space.models import (
    LocalWorkerCheckpoint,
    LocalWorkerResultReceipt,
)
from logion_api.knowledge_space.schemas import (
    LocalWorkerCheckpointRequest,
    LocalWorkerCheckpointResponse,
    LocalWorkerJobState,
    LocalWorkerLeaseCreateRequest,
    LocalWorkerLeaseResponse,
    LocalWorkerLeaseState,
    LocalWorkerRecoveryResponse,
    LocalWorkerResultRequest,
    LocalWorkerResultResponse,
    LocalWorkerRevokeResponse,
    LocalWorkerStage,
)

ERROR = {"model": ErrorResponse}
ERRORS: dict[int | str, dict[str, Any]] = {
    code: ERROR for code in (400, 401, 403, 404, 409, 413, 422, 429, 503)
}


async def require_local_worker_feature(settings: SettingsDependency) -> None:
    if not settings.knowledge_space_local_worker_enabled:
        raise local_worker_disabled_error()


router = APIRouter(
    prefix="/api/v1/local-worker",
    tags=["local-worker"],
    dependencies=[Depends(require_local_worker_feature)],
)


async def _user_write_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None,
) -> AuthContext:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    identity.require_recent_authentication(context)
    subject = get_security().privacy_hash(f"local-worker:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="knowledge_local_worker",
        subject_hash=subject,
        limit=settings.local_worker_write_limit_per_hour,
        window=3600,
    )
    return context


async def _worker_boundary(
    lease_id: UUID,
    authorization: str | None,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
) -> str:
    token = _bearer_token(authorization)
    subject = get_security().privacy_hash(f"local-worker-lease:{lease_id}") or "unknown"
    await limiter.enforce(
        scope="knowledge_local_worker_token",
        subject_hash=subject,
        limit=settings.local_worker_write_limit_per_hour,
        window=3600,
    )
    return token


def _bearer_token(authorization: str | None) -> str:
    if authorization is None or len(authorization) > 512:
        raise local_worker_token_invalid_error()
    scheme, separator, token = authorization.partition(" ")
    if separator == "" or scheme.casefold() != "bearer" or not token or " " in token:
        raise local_worker_token_invalid_error()
    return token


def _checkpoint_response(row: LocalWorkerCheckpoint) -> LocalWorkerCheckpointResponse:
    return LocalWorkerCheckpointResponse(
        job_id=row.job_id,
        lease_id=row.lease_id,
        workspace_id=row.workspace_id,
        space_id=row.space_id,
        input_sha256=row.input_sha256,
        stage=LocalWorkerStage(row.stage),
        output_sha256=row.output_sha256,
        updated_at=row.updated_at,
    )


def _result_response(
    receipt: LocalWorkerResultReceipt,
    *,
    replayed: bool,
) -> LocalWorkerResultResponse:
    return LocalWorkerResultResponse(
        receipt_id=receipt.id,
        job_id=receipt.job_id,
        lease_id=receipt.lease_id,
        idempotency_key=receipt.idempotency_key,
        output_sha256=receipt.output_sha256,
        accepted_at=receipt.accepted_at,
        replayed=replayed,
    )


@router.post(
    "/leases",
    response_model=LocalWorkerLeaseResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledge_local_worker_lease_issue",
    responses=ERRORS,
)
async def issue_lease(
    payload: LocalWorkerLeaseCreateRequest,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: LocalWorkerServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> LocalWorkerLeaseResponse:
    await _user_write_boundary(
        request,
        context,
        identity,
        limiter,
        settings,
        x_csrf_token,
    )
    lease, token = await service.issue_lease(
        db,
        context,
        payload,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    # The token is returned exactly once and is never reconstructed from the DB.
    return LocalWorkerLeaseResponse(
        lease_id=lease.id,
        job_id=lease.job_id,
        workspace_id=lease.workspace_id,
        space_id=lease.space_id,
        input_sha256=payload.input_sha256,
        issued_at=lease.issued_at,
        expires_at=lease.expires_at,
        state="active",
        token=token,
    )


@router.post(
    "/leases/{lease_id}/revoke",
    response_model=LocalWorkerRevokeResponse,
    operation_id="knowledge_local_worker_lease_revoke",
    responses=ERRORS,
)
async def revoke_lease(
    lease_id: UUID,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: LocalWorkerServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> LocalWorkerRevokeResponse:
    await _user_write_boundary(request, context, identity, limiter, settings, x_csrf_token)
    lease = await service.revoke_lease(
        db,
        context,
        lease_id,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    return LocalWorkerRevokeResponse(
        lease_id=lease.id,
        state=LocalWorkerLeaseState(lease.state),
    )


@router.post(
    "/jobs/{job_id}/checkpoints",
    response_model=LocalWorkerCheckpointResponse,
    operation_id="knowledge_local_worker_checkpoint",
    responses=ERRORS,
)
async def checkpoint(
    job_id: UUID,
    payload: LocalWorkerCheckpointRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: LocalWorkerServiceDependency,
    authorization: str | None = Header(default=None),
) -> LocalWorkerCheckpointResponse:
    token = await _worker_boundary(payload.lease_id, authorization, limiter, settings)
    row = await service.checkpoint(
        db,
        payload,
        token,
        job_id=job_id,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    return _checkpoint_response(row)


@router.post(
    "/jobs/{job_id}/result",
    response_model=LocalWorkerResultResponse,
    operation_id="knowledge_local_worker_result",
    responses=ERRORS,
)
async def submit_result(
    job_id: UUID,
    payload: LocalWorkerResultRequest,
    request: Request,
    response: Response,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: LocalWorkerServiceDependency,
    authorization: str | None = Header(default=None),
) -> LocalWorkerResultResponse:
    token = await _worker_boundary(payload.lease_id, authorization, limiter, settings)
    receipt, replayed = await service.submit_result(
        db,
        payload,
        token,
        job_id=job_id,
        request_id=request_id(request),
    )
    await db.commit()
    response.headers["Cache-Control"] = "private, no-store"
    return _result_response(receipt, replayed=replayed)


@router.get(
    "/jobs/{job_id}/recovery",
    response_model=LocalWorkerRecoveryResponse,
    operation_id="knowledge_local_worker_recovery",
    responses=ERRORS,
)
async def recovery(
    job_id: UUID,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: LocalWorkerServiceDependency,
) -> LocalWorkerRecoveryResponse:
    require_trusted_origin(request, settings)
    subject = get_security().privacy_hash(f"local-worker-recovery:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="knowledge_local_worker_recovery",
        subject_hash=subject,
        limit=settings.local_worker_write_limit_per_hour,
        window=3600,
    )
    job, checkpoint = await service.recovery(db, context, job_id)
    response.headers["Cache-Control"] = "private, no-store"
    return LocalWorkerRecoveryResponse(
        job_id=job.id,
        state=LocalWorkerJobState(job.state),
        checkpoint=_checkpoint_response(checkpoint) if checkpoint is not None else None,
    )
