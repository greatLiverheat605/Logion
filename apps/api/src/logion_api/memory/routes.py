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
from logion_api.memory.models import MasteryRecord, ReviewSchedule, Topic
from logion_api.memory.schemas import (
    MasteryConfirmationResponse,
    MasteryConfirmRequest,
    MasteryResponse,
    ReviewScheduleResponse,
    TopicCreateRequest,
    TopicDependencyCreateRequest,
    TopicDependencyResponse,
    TopicListResponse,
    TopicResponse,
)

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
    views = await memory.list_topics(
        db, context, workspace_id, space_id, request_id(request)
    )
    return TopicListResponse(
        topics=[
            topic_response(view.topic, view.mastery, view.review_schedule) for view in views
        ]
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
    await write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
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
    await write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
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
    await write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    result = await memory.confirm_mastery(
        db, context, workspace_id, space_id, topic_id, payload, request_id(request)
    )
    await db.commit()
    return MasteryConfirmationResponse(
        mastery=mastery_response(result.mastery),
        review_schedule=schedule_response(result.review_schedule),
    )
