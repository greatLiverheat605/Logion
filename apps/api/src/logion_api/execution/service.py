from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.models import SessionEvent, StudySession, Task
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.planning.models import LearningPlan, PlanPhase, PlanVersion
from logion_api.workspaces.models import Space, Workspace
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

TRANSITIONS: dict[str, frozenset[str]] = {
    "backlog": frozenset({"planned", "cancelled"}),
    "planned": frozenset({"in_progress", "blocked", "cancelled"}),
    "in_progress": frozenset({"submitted", "blocked", "cancelled"}),
    "blocked": frozenset({"planned", "in_progress", "cancelled"}),
    "submitted": frozenset({"in_progress"}),
    "verified": frozenset(),
    "done": frozenset(),
    "cancelled": frozenset(),
}


class ExecutionService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    @staticmethod
    def conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)

    async def _writable_space(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
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

    async def create_task(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        task_id: UUID,
        goal_id: UUID,
        phase_id: UUID | None,
        title: str,
        description: str,
        priority: int,
        estimated_minutes: int,
        planned_at: datetime | None,
        due_at: datetime | None,
        request_id: str,
    ) -> Task:
        await self._writable_space(db, context, workspace_id, space_id, request_id)
        from logion_api.planning.models import LearningGoal

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
        if phase_id is not None:
            phase = await db.scalar(
                select(PlanPhase)
                .join(PlanVersion, PlanVersion.id == PlanPhase.plan_version_id)
                .join(LearningPlan, LearningPlan.id == PlanVersion.plan_id)
                .where(
                    PlanPhase.id == phase_id,
                    PlanPhase.workspace_id == workspace_id,
                    LearningPlan.goal_id == goal_id,
                )
            )
            if phase is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
                )
        count = int(
            await db.scalar(
                select(func.count(Task.id)).where(
                    Task.goal_id == goal_id, Task.deleted_at.is_(None)
                )
            )
            or 0
        )
        if count >= self._settings.task_per_goal_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The learning goal has reached its task limit.",
                status_code=409,
            )
        if await db.get(Task, task_id) is not None:
            raise self.conflict("The task identifier already exists.")
        actor = context.user.id
        task = Task(
            id=task_id,
            workspace_id=workspace_id,
            space_id=space_id,
            goal_id=goal_id,
            phase_id=phase_id,
            title=title,
            description=description,
            status="planned" if planned_at is not None else "backlog",
            priority=priority,
            estimated_minutes=estimated_minutes,
            planned_at=planned_at,
            due_at=due_at,
            created_by=actor,
            updated_by=actor,
        )
        db.add(task)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="execution.task_created",
                result="success",
                actor_id=actor,
                workspace_id=workspace_id,
                target_type="task",
                target_id=task.id,
                metadata={"goal_id": str(goal_id), "has_phase": phase_id is not None},
            )
        )
        return task

    async def transition_task(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        task_id: UUID,
        *,
        expected_version: int,
        desired_status: str,
        blocked_reason: str | None,
        request_id: str,
    ) -> Task:
        await self._writable_space(db, context, workspace_id, space_id, request_id)
        # Serialize starts across every Space in a Workspace so the pre-check and
        # the partial unique index enforce one active session without a race.
        await db.scalar(select(Workspace.id).where(Workspace.id == workspace_id).with_for_update())
        task = await db.scalar(
            select(Task)
            .where(
                Task.id == task_id,
                Task.workspace_id == workspace_id,
                Task.space_id == space_id,
                Task.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if task is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if task.version != expected_version or desired_status not in TRANSITIONS[task.status]:
            raise self.conflict("The task changed or the transition is not allowed.")
        if desired_status == "blocked" and not blocked_reason:
            raise APIError(
                code="VALIDATION_ERROR",
                message="A blocked task requires a reason.",
                status_code=422,
            )
        task.status = desired_status
        task.blocked_reason = blocked_reason if desired_status == "blocked" else None
        task.version += 1
        task.updated_by = context.user.id
        task.updated_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="execution.task_transitioned",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="task",
                target_id=task.id,
                metadata={"from": expected_version, "status": desired_status},
            )
        )
        return task

    async def start_session(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        session_id: UUID,
        task_id: UUID,
        request_id: str,
    ) -> StudySession:
        await self._writable_space(db, context, workspace_id, space_id, request_id)
        task = await db.scalar(
            select(Task)
            .where(
                Task.id == task_id,
                Task.workspace_id == workspace_id,
                Task.space_id == space_id,
                Task.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if task is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if task.status not in {"planned", "in_progress"}:
            raise self.conflict("Only planned or active tasks can start a session.")
        active = await db.scalar(
            select(StudySession.id).where(
                StudySession.workspace_id == workspace_id,
                StudySession.created_by == context.user.id,
                StudySession.status == "active",
                StudySession.deleted_at.is_(None),
            )
        )
        if active is not None or await db.get(StudySession, session_id) is not None:
            raise self.conflict("An active session or identifier already exists.")
        now = utc_now()
        session = StudySession(
            id=session_id,
            workspace_id=workspace_id,
            space_id=space_id,
            task_id=task.id,
            created_by=context.user.id,
            updated_by=context.user.id,
            started_at=now,
        )
        if task.status == "planned":
            task.status = "in_progress"
            task.version += 1
            task.updated_at = now
            task.updated_by = context.user.id
        db.add(session)
        await db.flush()
        db.add(
            SessionEvent(
                workspace_id=workspace_id,
                session_id=session.id,
                event_type="started",
                occurred_at=now,
                event_metadata={"task_id": str(task.id)},
            )
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="execution.session_started",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="study_session",
                target_id=session.id,
                metadata={"task_id": str(task.id)},
            )
        )
        return session

    async def finish_session(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        session_id: UUID,
        *,
        expected_version: int,
        outcome: Literal["completed", "abandoned"],
        manual_minutes: int | None,
        reflection: str,
        request_id: str,
    ) -> StudySession:
        await self._writable_space(db, context, workspace_id, space_id, request_id)
        session = await db.scalar(
            select(StudySession)
            .where(
                StudySession.id == session_id,
                StudySession.workspace_id == workspace_id,
                StudySession.space_id == space_id,
                StudySession.created_by == context.user.id,
                StudySession.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if session is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if session.status != "active" or session.version != expected_version:
            raise self.conflict("The study session is no longer active.")
        now = utc_now()
        session.status = outcome
        session.ended_at = now
        session.manual_minutes = manual_minutes
        session.reflection = reflection
        session.version += 1
        session.updated_at = now
        session.updated_by = context.user.id
        db.add(
            SessionEvent(
                workspace_id=workspace_id,
                session_id=session.id,
                event_type=outcome,
                occurred_at=now,
                event_metadata={"manual_minutes": manual_minutes},
            )
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="execution.session_finished",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="study_session",
                target_id=session.id,
                metadata={"outcome": outcome, "manual_minutes": manual_minutes},
            )
        )
        return session
