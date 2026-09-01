from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.planning.schemas import GoalPlanCreateRequest
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


@dataclass(frozen=True)
class GoalPlanAggregate:
    goal: LearningGoal
    plan: LearningPlan
    plan_version: PlanVersion
    phases: list[PlanPhase]


class PlanningService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    @staticmethod
    def conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)

    async def _resolve_writable_space(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        request_id: str,
    ) -> Space:
        space = await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if space.visibility == "shared":
            await self._workspaces.resolve_workspace(
                db,
                context,
                workspace_id,
                request_id=request_id,
                permission=Permission.SHARED_PLAN_WRITE,
            )
        return space

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: GoalPlanCreateRequest,
        *,
        request_id: str,
    ) -> GoalPlanAggregate:
        await self._resolve_writable_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        count = int(
            await db.scalar(
                select(func.count(LearningGoal.id)).where(
                    LearningGoal.workspace_id == workspace_id,
                    LearningGoal.space_id == space_id,
                    LearningGoal.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.goal_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The Space has reached its learning goal limit.",
                status_code=409,
            )
        supplied_ids = [
            payload.goal_id,
            payload.plan_id,
            payload.plan_version_id,
            *(phase.id for phase in payload.phases),
        ]
        collision = await db.scalar(
            select(LearningGoal.id).where(LearningGoal.id.in_(supplied_ids)).limit(1)
        )
        if collision is not None:
            raise self.conflict("A supplied planning identifier already exists.")
        for model in (LearningPlan, PlanVersion, PlanPhase):
            if await db.scalar(select(model.id).where(model.id.in_(supplied_ids)).limit(1)):
                raise self.conflict("A supplied planning identifier already exists.")
        actor = context.user.id
        goal = LearningGoal(
            id=payload.goal_id,
            workspace_id=workspace_id,
            space_id=space_id,
            title=payload.title,
            description=payload.description,
            desired_outcome=payload.desired_outcome,
            weekly_minutes=payload.weekly_minutes,
            target_date=payload.target_date,
            created_by=actor,
            updated_by=actor,
        )
        plan = LearningPlan(
            id=payload.plan_id,
            workspace_id=workspace_id,
            space_id=space_id,
            goal_id=goal.id,
            title=payload.title,
            created_by=actor,
        )
        version = PlanVersion(
            id=payload.plan_version_id,
            workspace_id=workspace_id,
            plan_id=plan.id,
            created_by=actor,
        )
        phases = [
            PlanPhase(
                id=item.id,
                workspace_id=workspace_id,
                plan_version_id=version.id,
                title=item.title,
                description=item.description,
                position=item.position,
                estimated_minutes=item.estimated_minutes,
                acceptance_criteria=item.acceptance_criteria,
            )
            for item in payload.phases
        ]
        db.add(goal)
        await db.flush()
        db.add(plan)
        await db.flush()
        db.add(version)
        await db.flush()
        db.add_all(phases)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="planning.goal_created",
                result="success",
                actor_id=actor,
                workspace_id=workspace_id,
                target_type="learning_goal",
                target_id=goal.id,
                metadata={"space_id": str(space_id), "phase_count": len(phases)},
            )
        )
        return GoalPlanAggregate(goal, plan, version, phases)

    async def list_goals(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        request_id: str,
    ) -> list[GoalPlanAggregate]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        goals = list(
            (
                await db.scalars(
                    select(LearningGoal)
                    .where(
                        LearningGoal.workspace_id == workspace_id,
                        LearningGoal.space_id == space_id,
                        LearningGoal.deleted_at.is_(None),
                    )
                    .order_by(LearningGoal.updated_at.desc(), LearningGoal.id.desc())
                )
            ).all()
        )
        if not goals:
            return []

        goal_ids = [goal.id for goal in goals]
        plans = list(
            (
                await db.scalars(
                    select(LearningPlan).where(
                        LearningPlan.workspace_id == workspace_id,
                        LearningPlan.space_id == space_id,
                        LearningPlan.goal_id.in_(goal_ids),
                    )
                )
            ).all()
        )
        plan_by_goal = {plan.goal_id: plan for plan in plans}
        if not plan_by_goal:
            return []

        versions = list(
            (
                await db.scalars(
                    select(PlanVersion)
                    .where(
                        PlanVersion.workspace_id == workspace_id,
                        PlanVersion.plan_id.in_([plan.id for plan in plans]),
                    )
                    .order_by(PlanVersion.version_number.desc())
                )
            ).all()
        )
        version_by_plan: dict[UUID, PlanVersion] = {}
        for candidate_version in versions:
            version_by_plan.setdefault(candidate_version.plan_id, candidate_version)
        selected_versions = list(version_by_plan.values())
        selected_version_ids = [version.id for version in selected_versions]
        phases = list(
            (
                await db.scalars(
                    select(PlanPhase)
                    .where(
                        PlanPhase.workspace_id == workspace_id,
                        PlanPhase.plan_version_id.in_(selected_version_ids),
                    )
                    .order_by(PlanPhase.position)
                )
            ).all()
        )
        phases_by_version: dict[UUID, list[PlanPhase]] = {}
        for phase in phases:
            phases_by_version.setdefault(phase.plan_version_id, []).append(phase)

        aggregates: list[GoalPlanAggregate] = []
        for goal in goals:
            plan = plan_by_goal.get(goal.id)
            version = version_by_plan.get(plan.id) if plan is not None else None
            if plan is None or version is None:
                continue
            aggregates.append(
                GoalPlanAggregate(
                    goal,
                    plan,
                    version,
                    phases_by_version.get(version.id, []),
                )
            )
        return aggregates

    async def publish(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        goal_id: UUID,
        *,
        expected_goal_version: int,
        expected_plan_version: int,
        change_summary: str,
        request_id: str,
    ) -> GoalPlanAggregate:
        await self._resolve_writable_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        goal = await db.scalar(
            select(LearningGoal)
            .where(
                LearningGoal.id == goal_id,
                LearningGoal.workspace_id == workspace_id,
                LearningGoal.space_id == space_id,
                LearningGoal.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if goal is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        plan = await db.scalar(
            select(LearningPlan).where(LearningPlan.goal_id == goal.id).with_for_update()
        )
        if plan is None:
            raise self.conflict("The learning plan is incomplete.")
        version = await db.scalar(
            select(PlanVersion)
            .where(PlanVersion.plan_id == plan.id, PlanVersion.status == "draft")
            .with_for_update()
        )
        if (
            version is None
            or goal.version != expected_goal_version
            or plan.version != expected_plan_version
        ):
            raise self.conflict("The goal or plan changed before publication.")
        phases = list(
            (
                await db.scalars(
                    select(PlanPhase)
                    .where(PlanPhase.plan_version_id == version.id)
                    .order_by(PlanPhase.position)
                )
            ).all()
        )
        if not phases:
            raise self.conflict("A plan requires at least one phase.")
        now = utc_now()
        goal.status = "active"
        goal.version += 1
        goal.updated_at = now
        goal.updated_by = context.user.id
        plan.status = "active"
        plan.version += 1
        plan.updated_at = now
        version.status = "published"
        version.change_summary = change_summary
        version.published_at = now
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="planning.plan_published",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="learning_plan",
                target_id=plan.id,
                metadata={"version_number": version.version_number, "phase_count": len(phases)},
            )
        )
        return GoalPlanAggregate(goal, plan, version, phases)
