from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.errors import ErrorResponse
from logion_api.exam.dependencies import ExamServiceDependency
from logion_api.exam.models import Exam, Subject, SyllabusNode
from logion_api.exam.schemas import (
    ExamCreateRequest,
    ExamListResponse,
    ExamResponse,
    SubjectCreateRequest,
    SubjectListResponse,
    SubjectResponse,
    SyllabusNodeCreateRequest,
    SyllabusNodeListResponse,
    SyllabusNodeResponse,
)
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


def subject_response(item: Subject) -> SubjectResponse:
    return SubjectResponse(
        id=item.id,
        exam_id=item.exam_id,
        name=item.name,
        weight_basis_points=item.weight_basis_points,
        status=cast(Any, item.status),
        version=item.version,
    )


def syllabus_node_response(item: SyllabusNode) -> SyllabusNodeResponse:
    return SyllabusNodeResponse(
        id=item.id,
        subject_id=item.subject_id,
        parent_id=item.parent_id,
        title=item.title,
        importance=item.importance,
        coverage_status=cast(Any, item.coverage_status),
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


@router.get(
    "/exam-subjects",
    response_model=SubjectListResponse,
    operation_id="exam_subject_list",
    responses=ERRORS,
)
async def list_subjects(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    exams: ExamServiceDependency,
) -> SubjectListResponse:
    items = await exams.list_subjects(db, context, workspace_id, space_id, request_id(request))
    return SubjectListResponse(subjects=[subject_response(item) for item in items])


@router.post(
    "/exam-subjects",
    response_model=SubjectResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="exam_subject_create",
    responses=ERRORS,
)
async def create_subject(
    workspace_id: UUID,
    space_id: UUID,
    payload: SubjectCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    exams: ExamServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SubjectResponse:
    await exam_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await exams.create_subject(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return subject_response(item)


@router.get(
    "/syllabus-nodes",
    response_model=SyllabusNodeListResponse,
    operation_id="syllabus_node_list",
    responses=ERRORS,
)
async def list_syllabus_nodes(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    exams: ExamServiceDependency,
) -> SyllabusNodeListResponse:
    items = await exams.list_syllabus_nodes(
        db, context, workspace_id, space_id, request_id(request)
    )
    return SyllabusNodeListResponse(nodes=[syllabus_node_response(item) for item in items])


@router.post(
    "/syllabus-nodes",
    response_model=SyllabusNodeResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="syllabus_node_create",
    responses=ERRORS,
)
async def create_syllabus_node(
    workspace_id: UUID,
    space_id: UUID,
    payload: SyllabusNodeCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    exams: ExamServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SyllabusNodeResponse:
    await exam_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await exams.create_syllabus_node(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return syllabus_node_response(item)
