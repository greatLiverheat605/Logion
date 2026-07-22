from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.exam.models import Exam, Subject, SyllabusNode
from logion_api.exam.schemas import (
    ExamCreateRequest,
    SubjectCreateRequest,
    SyllabusNodeCreateRequest,
)
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

    async def create_subject(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: SubjectCreateRequest,
        request_id: str,
    ) -> Subject:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        exam = await db.scalar(
            select(Exam)
            .where(
                Exam.id == payload.exam_id,
                Exam.workspace_id == workspace_id,
                Exam.space_id == space_id,
                Exam.user_id == context.user.id,
                Exam.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if exam is None:
            raise APIError(code="RESOURCE_NOT_FOUND", message="Exam not found.", status_code=404)
        if await db.get(Subject, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        subjects = list(
            (
                await db.scalars(
                    select(Subject).where(
                        Subject.exam_id == exam.id,
                        Subject.user_id == context.user.id,
                        Subject.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        if len(subjects) >= self._settings.exam_subject_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its subject limit.",
                status_code=409,
            )
        if any(item.name.casefold() == payload.name.casefold() for item in subjects):
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Subject name exists.", status_code=409
            )
        if sum(item.weight_basis_points for item in subjects) + payload.weight_basis_points > 10000:
            raise APIError(
                code="RESOURCE_STATE_INVALID",
                message="Subject weights cannot exceed 100 percent.",
                status_code=409,
            )
        subject = Subject(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            exam_id=exam.id,
            user_id=context.user.id,
            name=payload.name,
            weight_basis_points=payload.weight_basis_points,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(subject)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="exam.subject_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="exam_subject",
                target_id=subject.id,
                metadata={},
            )
        )
        return subject

    async def list_subjects(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[Subject]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        return list(
            (
                await db.scalars(
                    select(Subject)
                    .where(
                        Subject.workspace_id == workspace_id,
                        Subject.space_id == space_id,
                        Subject.user_id == context.user.id,
                        Subject.deleted_at.is_(None),
                    )
                    .order_by(Subject.exam_id, Subject.id)
                    .limit(10000)
                )
            ).all()
        )

    async def create_syllabus_node(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: SyllabusNodeCreateRequest,
        request_id: str,
    ) -> SyllabusNode:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        subject = await db.scalar(
            select(Subject)
            .where(
                Subject.id == payload.subject_id,
                Subject.workspace_id == workspace_id,
                Subject.space_id == space_id,
                Subject.user_id == context.user.id,
                Subject.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if subject is None:
            raise APIError(code="RESOURCE_NOT_FOUND", message="Subject not found.", status_code=404)
        if await db.get(SyllabusNode, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        count = int(
            await db.scalar(
                select(func.count(SyllabusNode.id)).where(
                    SyllabusNode.workspace_id == workspace_id,
                    SyllabusNode.user_id == context.user.id,
                    SyllabusNode.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.syllabus_node_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its syllabus-node limit.",
                status_code=409,
            )
        if payload.parent_id is not None:
            parent = await db.scalar(
                select(SyllabusNode.id).where(
                    SyllabusNode.id == payload.parent_id,
                    SyllabusNode.subject_id == subject.id,
                    SyllabusNode.user_id == context.user.id,
                    SyllabusNode.deleted_at.is_(None),
                )
            )
            if parent is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Parent node not found.", status_code=404
                )
        node = SyllabusNode(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            subject_id=subject.id,
            parent_id=payload.parent_id,
            user_id=context.user.id,
            title=payload.title,
            importance=payload.importance,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(node)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="exam.syllabus_node_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="syllabus_node",
                target_id=node.id,
                metadata={},
            )
        )
        return node

    async def list_syllabus_nodes(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[SyllabusNode]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        return list(
            (
                await db.scalars(
                    select(SyllabusNode)
                    .where(
                        SyllabusNode.workspace_id == workspace_id,
                        SyllabusNode.space_id == space_id,
                        SyllabusNode.user_id == context.user.id,
                        SyllabusNode.deleted_at.is_(None),
                    )
                    .order_by(SyllabusNode.subject_id, SyllabusNode.id)
                    .limit(10000)
                )
            ).all()
        )
