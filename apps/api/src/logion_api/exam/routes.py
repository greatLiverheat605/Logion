from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.errors import ErrorResponse
from logion_api.exam.dependencies import ExamServiceDependency
from logion_api.exam.models import Exam
from logion_api.exam.schemas import ExamCreateRequest, ExamListResponse, ExamResponse
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}", tags=["exam"])
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


def exam_response(item: Exam) -> ExamResponse:
    return ExamResponse(
        id=item.id,
        workspace_id=item.workspace_id,
        space_id=item.space_id,
        title=item.title,
        date_status=cast(Any, item.date_status),
        exam_at=item.exam_at,
        timezone=item.timezone,
        target_score=item.target_score,
        score_scale_max=item.score_scale_max,
        status=cast(Any, item.status),
        version=item.version,
    )


async def exam_write_boundary(
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
        scope="exam_write",
        subject_hash=subject,
        limit=settings.exam_write_limit_per_hour,
        window=3600,
    )


@router.get(
    "/exams",
    response_model=ExamListResponse,
    operation_id="exam_list",
    responses=ERRORS,
)
async def list_exams(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    exams: ExamServiceDependency,
) -> ExamListResponse:
    items = await exams.list_exams(db, context, workspace_id, space_id, request_id(request))
    return ExamListResponse(exams=[exam_response(item) for item in items])


@router.post(
    "/exams",
    response_model=ExamResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="exam_create",
    responses=ERRORS,
)
async def create_exam(
    workspace_id: UUID,
    space_id: UUID,
    payload: ExamCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    exams: ExamServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ExamResponse:
    await exam_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await exams.create_exam(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return exam_response(item)
