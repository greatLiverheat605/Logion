from typing import Any, Literal, cast
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
from logion_api.planning.dependencies import PlanningServiceDependency
from logion_api.planning.schemas import (
    GoalPlanCreateRequest,
    GoalPlanResponse,
    PhaseResponse,
    PlanPublishRequest,
)
from logion_api.planning.service import GoalPlanAggregate

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
    tags=["planning"],
)

ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    429: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


def response(aggregate: GoalPlanAggregate) -> GoalPlanResponse:
    goal = aggregate.goal
    plan = aggregate.plan
    version = aggregate.plan_version
    return GoalPlanResponse(
        goal_id=goal.id,
        plan_id=plan.id,
        plan_version_id=version.id,
        workspace_id=goal.workspace_id,
        space_id=goal.space_id,
        title=goal.title,
        description=goal.description,
        desired_outcome=goal.desired_outcome,
        weekly_minutes=goal.weekly_minutes,
        target_date=goal.target_date,
        goal_status=cast(Literal["draft", "active", "completed", "archived"], goal.status),
        plan_status=cast(Literal["draft", "active", "archived"], plan.status),
        plan_version_status=cast(Literal["draft", "published", "superseded"], version.status),
        goal_version=goal.version,
        plan_version=plan.version,
        version_number=version.version_number,
        created_at=goal.created_at,
        phases=[
            PhaseResponse(
                id=phase.id,
                title=phase.title,
                description=phase.description,
                position=phase.position,
                estimated_minutes=phase.estimated_minutes,
                acceptance_criteria=phase.acceptance_criteria,
            )
            for phase in aggregate.phases
        ],
    )


async def enforce_write_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    x_csrf_token: str | None,
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="planning_write",
        subject_hash=subject,
        limit=settings.planning_write_limit_per_hour,
        window=3600,
    )


@router.post(
    "",
    response_model=GoalPlanResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="planning_goal_create",
    responses=ERRORS,
)
async def create_goal_plan(
    workspace_id: UUID,
    space_id: UUID,
    payload: GoalPlanCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    planning: PlanningServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> GoalPlanResponse:
    await enforce_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    aggregate = await planning.create(
        db,
        context,
        workspace_id,
        space_id,
        payload,
        request_id=request_id(request),
    )
    await db.commit()
    return response(aggregate)


@router.post(
    "/{goal_id}/publish",
    response_model=GoalPlanResponse,
    operation_id="planning_plan_publish",
    responses=ERRORS,
)
async def publish_plan(
    workspace_id: UUID,
    space_id: UUID,
    goal_id: UUID,
    payload: PlanPublishRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    planning: PlanningServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> GoalPlanResponse:
    await enforce_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    aggregate = await planning.publish(
        db,
        context,
        workspace_id,
        space_id,
        goal_id,
        expected_goal_version=payload.expected_goal_version,
        expected_plan_version=payload.expected_plan_version,
        change_summary=payload.change_summary,
        request_id=request_id(request),
    )
    await db.commit()
    return response(aggregate)
