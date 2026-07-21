from typing import Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status
from sqlalchemy import select

from logion_api.errors import ErrorResponse
from logion_api.execution.evidence_dependencies import EvidenceServiceDependency
from logion_api.execution.evidence_models import VerificationRecord
from logion_api.execution.evidence_schemas import (
    EvidenceResponse,
    EvidenceSubmitRequest,
    TaskCloseRequest,
    VerificationDecisionRequest,
    VerificationResponse,
)
from logion_api.execution.evidence_service import EvidenceAggregate
from logion_api.execution.models import Task
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
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}", tags=["verification"]
)
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
        scope="verification_write",
        subject_hash=subject,
        limit=settings.verification_write_limit_per_hour,
        window=3600,
    )


def evidence_response(aggregate: EvidenceAggregate) -> EvidenceResponse:
    item, record, task = aggregate.evidence, aggregate.verification, aggregate.task
    return EvidenceResponse(
        evidence_id=item.id,
        verification_id=record.id,
        task_id=task.id,
        evidence_type=cast(Literal["text", "link", "note", "resource"], item.evidence_type),
        summary=item.summary,
        external_url=item.external_url,
        note_id=item.note_id,
        resource_id=item.resource_id,
        evidence_version=item.version,
        verification_version=record.version,
        verdict=cast(Literal["pending", "passed", "failed", "needs_revision"], record.verdict),
        task_status=cast(Any, task.status),
        task_version=task.version,
    )


def verification_response(record: VerificationRecord, task: Task) -> VerificationResponse:
    return VerificationResponse(
        verification_id=record.id,
        evidence_id=record.evidence_id,
        task_id=task.id,
        verdict=cast(Literal["pending", "passed", "failed", "needs_revision"], record.verdict),
        reviewer_notes=record.reviewer_notes,
        version=record.version,
        task_status=cast(Any, task.status),
        task_version=task.version,
    )


@router.post(
    "/evidence",
    response_model=EvidenceResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="evidence_submit",
    responses=ERRORS,
)
async def submit_evidence(
    workspace_id: UUID,
    space_id: UUID,
    payload: EvidenceSubmitRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    evidence: EvidenceServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> EvidenceResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    aggregate = await evidence.submit(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return evidence_response(aggregate)


@router.post(
    "/verifications/{verification_id}/decision",
    response_model=VerificationResponse,
    operation_id="verification_decide",
    responses=ERRORS,
)
async def decide_verification(
    workspace_id: UUID,
    space_id: UUID,
    verification_id: UUID,
    payload: VerificationDecisionRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    evidence: EvidenceServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> VerificationResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    aggregate = await evidence.decide(
        db,
        context,
        workspace_id,
        space_id,
        verification_id,
        payload.expected_version,
        payload.verdict,
        payload.reviewer_notes,
        request_id(request),
    )
    await db.commit()
    return verification_response(aggregate.verification, aggregate.task)


@router.post(
    "/tasks/{task_id}/close",
    response_model=VerificationResponse,
    operation_id="verified_task_close",
    responses=ERRORS,
)
async def close_task(
    workspace_id: UUID,
    space_id: UUID,
    task_id: UUID,
    payload: TaskCloseRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    evidence: EvidenceServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> VerificationResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    task = await evidence.close_task(
        db,
        context,
        workspace_id,
        space_id,
        task_id,
        payload.expected_task_version,
        request_id(request),
    )
    record = await db.scalar(
        select(VerificationRecord)
        .where(VerificationRecord.task_id == task.id, VerificationRecord.verdict == "passed")
        .order_by(VerificationRecord.decided_at.desc())
    )
    assert record is not None
    await db.commit()
    return verification_response(record, task)
