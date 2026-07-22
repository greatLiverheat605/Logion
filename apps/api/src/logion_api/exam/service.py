from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.exam.models import Exam
from logion_api.exam.schemas import ExamCreateRequest
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService


class ExamService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    async def create_exam(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: ExamCreateRequest,
        request_id: str,
    ) -> Exam:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        await db.scalar(
            select(WorkspaceMembership.id)
            .where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == context.user.id,
                WorkspaceMembership.status == "active",
            )
            .with_for_update()
        )
        if await db.get(Exam, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        count = int(
            await db.scalar(
                select(func.count(Exam.id)).where(
                    Exam.workspace_id == workspace_id,
                    Exam.user_id == context.user.id,
                    Exam.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.exam_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its exam limit.",
                status_code=409,
            )
        exam = Exam(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            title=payload.title,
            date_status=payload.date_status,
            exam_at=payload.exam_at,
            timezone=payload.timezone,
            target_score=payload.target_score,
            score_scale_max=payload.score_scale_max,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(exam)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="exam.created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="exam",
                target_id=exam.id,
                metadata={"date_status": exam.date_status},
            )
        )
        return exam

    async def list_exams(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[Exam]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        return list(
            (
                await db.scalars(
                    select(Exam)
                    .where(
                        Exam.workspace_id == workspace_id,
                        Exam.space_id == space_id,
                        Exam.user_id == context.user.id,
                        Exam.deleted_at.is_(None),
                    )
                    .order_by(Exam.exam_at.asc().nulls_last(), Exam.id)
                    .limit(500)
                )
            ).all()
        )
