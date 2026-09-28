from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.models import Task
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import require_enabled
from logion_api.planning.dependencies import PlanningServiceDependency
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.planning.online_schemas import OnlineGoalPage, OnlineGoalUpdate, OnlineGoalView
from logion_api.planning.routes import ERRORS, enforce_write_boundary, response
from logion_api.planning.schemas import (
    GoalPhaseRevisionRequest,
    GoalPlanCreateRequest,
    PlanPublishRequest,
)
from logion_api.planning.service import GoalPlanAggregate
from logion_api.sync.models import WorkspaceSyncState
from logion_api.sync.push import canonical_hash, goal_payload
from logion_api.sync.service import AppliedSyncChange, SyncLedgerService, SyncOperationIdentity

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/goals",
    tags=["research-planning"],
    dependencies=[Depends(require_enabled)],
    responses=ERRORS,
)


async def prepare_write(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    planning: PlanningServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceSyncState:
    await enforce_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    await planning._resolve_writable_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    # Match legacy sync lock order, then recheck access after the lock wait.
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    await planning._resolve_writable_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    return state


OnlineState = Annotated[WorkspaceSyncState, Depends(prepare_write)]


async def views(db: DatabaseSession, aggregates: list[GoalPlanAggregate]) -> list[OnlineGoalView]:
    phase_ids = [phase.id for aggregate in aggregates for phase in aggregate.phases]
    referenced = (
        set(await db.scalars(select(Task.phase_id).where(Task.phase_id.in_(phase_ids)).distinct()))
        if phase_ids
        else set()
    )
    return [
        OnlineGoalView.model_validate(
            {
                **response(aggregate).model_dump(),
                "phases": [
                    {
                        **phase,
                        "archived_at": row.archived_at,
                        "removal_allowed": row.id not in referenced,
                    }
                    for phase, row in zip(
                        response(aggregate).model_dump()["phases"], aggregate.phases, strict=True
                    )
                ],
            }
        )
        for aggregate in aggregates
    ]


async def save(
    db: DatabaseSession,
    context: AuthContextDependency,
    state: WorkspaceSyncState,
    aggregate: GoalPlanAggregate,
    operation: Literal["create", "update"],
) -> OnlineGoalView:
    await db.flush()
    value = goal_payload(aggregate.goal, aggregate.plan, aggregate.plan_version, aggregate.phases)
    digest = canonical_hash(value)
    await SyncLedgerService().append_applied(
        db,
        state,
        SyncOperationIdentity(
            operation_id=uuid7(),
            workspace_id=aggregate.goal.workspace_id,
            device_id=context.device.id,
            payload_hash=digest,
            operation_fingerprint=digest,
            entity_type="learning_goal",
            entity_id=aggregate.goal.id,
            operation_type=operation,
        ),
        AppliedSyncChange(
            server_version=aggregate.goal.version, payload=value, payload_hash=digest
        ),
    )
    result = (await views(db, [aggregate]))[0]
    await db.commit()
    return result


@router.get("", response_model=OnlineGoalPage, operation_id="online_goal_list")
async def list_goals(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    planning: PlanningServiceDependency,
) -> OnlineGoalPage:
    aggregates = await planning.list_goals(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    return OnlineGoalPage(goals=await views(db, aggregates))


@router.post("", response_model=OnlineGoalView, status_code=201, operation_id="online_goal_create")
async def create_goal(
    workspace_id: UUID,
    space_id: UUID,
    payload: GoalPlanCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    planning: PlanningServiceDependency,
    state: OnlineState,
) -> OnlineGoalView:
    aggregate = await planning.create(
        db, context, workspace_id, space_id, payload, request_id=request_id(request)
    )
    return await save(db, context, state, aggregate, "create")


@router.patch("/{goal_id}", response_model=OnlineGoalView, operation_id="online_goal_update")
async def update_goal(
    workspace_id: UUID,
    space_id: UUID,
    goal_id: UUID,
    payload: OnlineGoalUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    planning: PlanningServiceDependency,
    settings: SettingsDependency,
    state: OnlineState,
) -> OnlineGoalView:
    if not settings.planning_phase_revision_enabled:
        raise APIError(
            code="FEATURE_DISABLED", message="Goal revision is not enabled.", status_code=403
        )
    row = (
        await db.execute(
            select(LearningGoal, LearningPlan, PlanVersion)
            .join(LearningPlan, LearningPlan.goal_id == LearningGoal.id)
            .join(PlanVersion, PlanVersion.plan_id == LearningPlan.id)
            .where(
                LearningGoal.id == goal_id,
                LearningGoal.workspace_id == workspace_id,
                LearningGoal.space_id == space_id,
                LearningGoal.deleted_at.is_(None),
            )
            .order_by(PlanVersion.version_number.desc())
            .limit(1)
            .with_for_update()
        )
    ).first()
    if row is None:
        raise APIError(code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404)
    goal, plan, version = row
    if goal.version != payload.expected_version:
        raise planning.conflict("The goal changed before the update.")
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    for name, value in changes.items():
        setattr(goal, name, value)
    goal.version += 1
    goal.updated_at = utc_now()
    goal.updated_by = context.user.id
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type="planning.goal_updated",
            result="success",
            actor_id=context.user.id,
            workspace_id=workspace_id,
            target_type="learning_goal",
            target_id=goal.id,
            metadata={"space_id": str(space_id), "fields": sorted(changes)},
        )
    )
    phases = list(
        await db.scalars(
            select(PlanPhase)
            .where(PlanPhase.plan_version_id == version.id)
            .order_by(PlanPhase.position)
        )
    )
    return await save(db, context, state, GoalPlanAggregate(goal, plan, version, phases), "update")


@router.put(
    "/{goal_id}/phases", response_model=OnlineGoalView, operation_id="online_goal_phases_update"
)
async def revise_phases(
    workspace_id: UUID,
    space_id: UUID,
    goal_id: UUID,
    payload: GoalPhaseRevisionRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    planning: PlanningServiceDependency,
    state: OnlineState,
) -> OnlineGoalView:
    aggregate = await planning.revise_phases(
        db, context, workspace_id, space_id, goal_id, payload, request_id=request_id(request)
    )
    return await save(db, context, state, aggregate, "update")


@router.post(
    "/{goal_id}/publish", response_model=OnlineGoalView, operation_id="online_goal_publish"
)
async def publish_goal(
    workspace_id: UUID,
    space_id: UUID,
    goal_id: UUID,
    payload: PlanPublishRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    planning: PlanningServiceDependency,
    state: OnlineState,
) -> OnlineGoalView:
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
    return await save(db, context, state, aggregate, "update")
