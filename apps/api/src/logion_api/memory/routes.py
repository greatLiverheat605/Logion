from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

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
from logion_api.memory.dependencies import MemoryServiceDependency
from logion_api.memory.models import (
    AuditReview,
    ErrorPattern,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewFinding,
    ReviewSchedule,
    Topic,
)
from logion_api.memory.schemas import (
    AuditReviewCompleteRequest,
    AuditReviewCreateRequest,
    AuditReviewListResponse,
    AuditReviewResponse,
    ErrorPatternListResponse,
    ErrorPatternResolveRequest,
    ErrorPatternResponse,
    MasteryConfirmationResponse,
    MasteryConfirmRequest,
    MasteryResponse,
    QuizAttemptCreateRequest,
    QuizAttemptListResponse,
    QuizAttemptResponse,
    QuizItemCreateRequest,
    QuizItemListResponse,
    QuizItemResponse,
    ReviewFindingCreateRequest,
    ReviewFindingResolveRequest,
    ReviewFindingResponse,
    ReviewScheduleResponse,
    TopicCreateRequest,
    TopicDependencyCreateRequest,
    TopicDependencyResponse,
    TopicListResponse,
    TopicResponse,
)
from logion_api.memory.service import AuditReviewView, QuizAttemptResult

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}", tags=["memory"])
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


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
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="memory_write",
        subject_hash=subject,
        limit=settings.memory_write_limit_per_hour,
        window=3600,
    )


def mastery_response(item: MasteryRecord) -> MasteryResponse:
    return MasteryResponse(
        id=item.id,
        topic_id=item.topic_id,
        suggested_level=cast(Any, item.suggested_level),
        suggested_reason=item.suggested_reason,
        suggested_at=item.suggested_at,
        confirmed_level=cast(Any, item.confirmed_level),
        confirmed_at=item.confirmed_at,
        version=item.version,
    )


def schedule_response(item: ReviewSchedule) -> ReviewScheduleResponse:
    return ReviewScheduleResponse(
        id=item.id,
        topic_id=item.topic_id,
        status=cast(Any, item.status),
        source=cast(Any, item.source),
        interval_days=item.interval_days,
        next_review_at=item.next_review_at,
        last_reviewed_at=item.last_reviewed_at,
        version=item.version,
    )


def topic_response(
    topic: Topic,
    mastery: MasteryRecord | None = None,
    schedule: ReviewSchedule | None = None,
) -> TopicResponse:
    return TopicResponse(
        id=topic.id,
        workspace_id=topic.workspace_id,
        space_id=topic.space_id,
        title=topic.title,
        description=topic.description,
        version=topic.version,
        mastery=mastery_response(mastery) if mastery is not None else None,
        review_schedule=schedule_response(schedule) if schedule is not None else None,
    )


def quiz_item_response(item: QuizItem) -> QuizItemResponse:
    return QuizItemResponse(
        id=item.id,
        topic_id=item.topic_id,
        prompt=item.prompt,
        evaluation_mode=cast(Any, item.evaluation_mode),
        version=item.version,
    )


def error_pattern_response(item: ErrorPattern) -> ErrorPatternResponse:
    return ErrorPatternResponse(
        id=item.id,
        topic_id=item.topic_id,
        cause=cast(Any, item.cause),
        occurrence_count=item.occurrence_count,
        status=cast(Any, item.status),
        latest_attempt_id=item.latest_attempt_id,
        version=item.version,
    )


def attempt_response(result: QuizAttemptResult) -> QuizAttemptResponse:
    attempt: QuizAttempt = result.attempt
    return QuizAttemptResponse(
        id=attempt.id,
        quiz_item_id=attempt.quiz_item_id,
        topic_id=attempt.topic_id,
        response_text=attempt.response_text,
        is_correct=attempt.is_correct,
        confidence=attempt.confidence,
        duration_seconds=attempt.duration_seconds,
        error_cause=cast(Any, attempt.error_cause),
        attempted_at=attempt.attempted_at,
        version=attempt.version,
        answer_key=result.item.answer_key,
        explanation=result.item.explanation,
        error_pattern=(
            error_pattern_response(result.error_pattern)
            if result.error_pattern is not None
            else None
        ),
        review_schedule=(
            schedule_response(result.review_schedule)
            if result.review_schedule is not None
            else None
        ),
    )


def finding_response(item: ReviewFinding) -> ReviewFindingResponse:
    return ReviewFindingResponse(
        id=item.id,
        audit_review_id=item.audit_review_id,
        category=cast(Any, item.category),
        description=item.description,
        suggested_action=item.suggested_action,
        status=cast(Any, item.status),
        version=item.version,
    )


def audit_review_response(view: AuditReviewView) -> AuditReviewResponse:
    item: AuditReview = view.review
    return AuditReviewResponse(
        id=item.id,
        cadence=cast(Any, item.cadence),
        period_start=item.period_start,
        period_end=item.period_end,
        status=cast(Any, item.status),
        summary=item.summary,
        completed_at=item.completed_at,
        version=item.version,
        findings=[finding_response(finding) for finding in view.findings],
    )


@router.get(
    "/topics",
    response_model=TopicListResponse,
    operation_id="topic_list",
    responses=ERRORS,
)
async def list_topics(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    memory: MemoryServiceDependency,
) -> TopicListResponse:
    views = await memory.list_topics(db, context, workspace_id, space_id, request_id(request))
    return TopicListResponse(
        topics=[topic_response(view.topic, view.mastery, view.review_schedule) for view in views]
    )


@router.post(
    "/topics",
    response_model=TopicResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="topic_create",
    responses=ERRORS,
)
async def create_topic(
    workspace_id: UUID,
    space_id: UUID,
    payload: TopicCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TopicResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    topic = await memory.create_topic(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return topic_response(topic)


@router.post(
    "/topic-dependencies",
    response_model=TopicDependencyResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="topic_dependency_create",
    responses=ERRORS,
)
async def create_dependency(
    workspace_id: UUID,
    space_id: UUID,
    payload: TopicDependencyCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TopicDependencyResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    dependency = await memory.add_dependency(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return TopicDependencyResponse(
        id=dependency.id,
        prerequisite_topic_id=dependency.prerequisite_topic_id,
        dependent_topic_id=dependency.dependent_topic_id,
        version=dependency.version,
    )


@router.put(
    "/topics/{topic_id}/mastery/confirmation",
    response_model=MasteryConfirmationResponse,
    operation_id="mastery_confirm",
    responses=ERRORS,
)
async def confirm_mastery(
    workspace_id: UUID,
    space_id: UUID,
    topic_id: UUID,
    payload: MasteryConfirmRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MasteryConfirmationResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    result = await memory.confirm_mastery(
        db, context, workspace_id, space_id, topic_id, payload, request_id(request)
    )
    await db.commit()
    return MasteryConfirmationResponse(
        mastery=mastery_response(result.mastery),
        review_schedule=schedule_response(result.review_schedule),
    )


@router.get(
    "/quiz-items",
    response_model=QuizItemListResponse,
    operation_id="quiz_item_list",
    responses=ERRORS,
)
async def list_quiz_items(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    memory: MemoryServiceDependency,
) -> QuizItemListResponse:
    items = await memory.list_quiz_items(db, context, workspace_id, space_id, request_id(request))
    return QuizItemListResponse(quiz_items=[quiz_item_response(item) for item in items])


@router.post(
    "/quiz-items",
    response_model=QuizItemResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="quiz_item_create",
    responses=ERRORS,
)
async def create_quiz_item(
    workspace_id: UUID,
    space_id: UUID,
    payload: QuizItemCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> QuizItemResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    item = await memory.create_quiz_item(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return quiz_item_response(item)


@router.post(
    "/quiz-items/{quiz_item_id}/attempts",
    response_model=QuizAttemptResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="quiz_attempt_create",
    responses=ERRORS,
)
async def submit_quiz_attempt(
    workspace_id: UUID,
    space_id: UUID,
    quiz_item_id: UUID,
    payload: QuizAttemptCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> QuizAttemptResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    result = await memory.submit_quiz_attempt(
        db,
        context,
        workspace_id,
        space_id,
        quiz_item_id,
        payload,
        request_id(request),
    )
    await db.commit()
    return attempt_response(result)


@router.get(
    "/quiz-attempts",
    response_model=QuizAttemptListResponse,
    operation_id="quiz_attempt_list",
    responses=ERRORS,
)
async def list_quiz_attempts(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    memory: MemoryServiceDependency,
) -> QuizAttemptListResponse:
    attempts = await memory.list_quiz_attempts(
        db, context, workspace_id, space_id, request_id(request)
    )
    return QuizAttemptListResponse(attempts=[attempt_response(item) for item in attempts])


@router.get(
    "/error-patterns",
    response_model=ErrorPatternListResponse,
    operation_id="error_pattern_list",
    responses=ERRORS,
)
async def list_error_patterns(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    memory: MemoryServiceDependency,
) -> ErrorPatternListResponse:
    patterns = await memory.list_error_patterns(
        db, context, workspace_id, space_id, request_id(request)
    )
    return ErrorPatternListResponse(
        error_patterns=[error_pattern_response(item) for item in patterns]
    )


@router.put(
    "/error-patterns/{pattern_id}/resolution",
    response_model=ErrorPatternResponse,
    operation_id="error_pattern_resolve",
    responses=ERRORS,
)
async def resolve_error_pattern(
    workspace_id: UUID,
    space_id: UUID,
    pattern_id: UUID,
    payload: ErrorPatternResolveRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ErrorPatternResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    pattern = await memory.resolve_error_pattern(
        db,
        context,
        workspace_id,
        space_id,
        pattern_id,
        payload,
        request_id(request),
    )
    await db.commit()
    return error_pattern_response(pattern)


@router.get(
    "/audit-reviews",
    response_model=AuditReviewListResponse,
    operation_id="audit_review_list",
    responses=ERRORS,
)
async def list_audit_reviews(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    memory: MemoryServiceDependency,
) -> AuditReviewListResponse:
    reviews = await memory.list_audit_reviews(
        db, context, workspace_id, space_id, request_id(request)
    )
    return AuditReviewListResponse(reviews=[audit_review_response(item) for item in reviews])


@router.post(
    "/audit-reviews",
    response_model=AuditReviewResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="audit_review_create",
    responses=ERRORS,
)
async def create_audit_review(
    workspace_id: UUID,
    space_id: UUID,
    payload: AuditReviewCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AuditReviewResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    review = await memory.create_audit_review(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return audit_review_response(review)


@router.post(
    "/audit-reviews/{review_id}/findings",
    response_model=ReviewFindingResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="review_finding_create",
    responses=ERRORS,
)
async def add_review_finding(
    workspace_id: UUID,
    space_id: UUID,
    review_id: UUID,
    payload: ReviewFindingCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ReviewFindingResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    finding = await memory.add_review_finding(
        db,
        context,
        workspace_id,
        space_id,
        review_id,
        payload,
        request_id(request),
    )
    await db.commit()
    return finding_response(finding)


@router.put(
    "/audit-reviews/{review_id}/completion",
    response_model=AuditReviewResponse,
    operation_id="audit_review_complete",
    responses=ERRORS,
)
async def complete_audit_review(
    workspace_id: UUID,
    space_id: UUID,
    review_id: UUID,
    payload: AuditReviewCompleteRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AuditReviewResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    review = await memory.complete_audit_review(
        db,
        context,
        workspace_id,
        space_id,
        review_id,
        payload,
        request_id(request),
    )
    await db.commit()
    return audit_review_response(review)


@router.put(
    "/audit-reviews/{review_id}/findings/{finding_id}/resolution",
    response_model=ReviewFindingResponse,
    operation_id="review_finding_resolve",
    responses=ERRORS,
)
async def resolve_review_finding(
    workspace_id: UUID,
    space_id: UUID,
    review_id: UUID,
    finding_id: UUID,
    payload: ReviewFindingResolveRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    memory: MemoryServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ReviewFindingResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    finding = await memory.resolve_review_finding(
        db,
        context,
        workspace_id,
        space_id,
        review_id,
        finding_id,
        payload,
        request_id(request),
    )
    await db.commit()
    return finding_response(finding)
