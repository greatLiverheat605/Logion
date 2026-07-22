from typing import Any, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.self_study.models import Deliverable, InboxItem, LearningTrack, StudyProject
from logion_api.self_study.schemas import (
    DeliverableCreateRequest,
    InboxItemCreateRequest,
    ProjectCreateRequest,
    TrackCreateRequest,
)
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService


class SelfStudyService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    async def _boundary(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> None:
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

    async def _quota(
        self,
        db: AsyncSession,
        model: type[LearningTrack] | type[StudyProject] | type[InboxItem] | type[Deliverable],
        workspace_id: UUID,
        user_id: UUID,
    ) -> None:
        count = int(
            await db.scalar(
                select(func.count(model.id)).where(
                    model.workspace_id == workspace_id,
                    model.user_id == user_id,
                    model.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.self_study_entity_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its self-study record limit.",
                status_code=409,
            )

    async def create_track(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: TrackCreateRequest,
        request_id: str,
    ) -> LearningTrack:
        await self._boundary(db, context, workspace_id, space_id, request_id)
        await self._quota(db, LearningTrack, workspace_id, context.user.id)
        await self._ensure_new(db, LearningTrack, payload.id)
        item = LearningTrack(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            title=payload.title,
            objective=payload.objective,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        await self._add(
            db,
            context,
            item,
            workspace_id,
            request_id,
            "self_study.track_created",
            "learning_track",
        )
        return item

    async def create_project(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: ProjectCreateRequest,
        request_id: str,
    ) -> StudyProject:
        await self._boundary(db, context, workspace_id, space_id, request_id)
        await self._quota(db, StudyProject, workspace_id, context.user.id)
        await self._ensure_new(db, StudyProject, payload.id)
        parent = await self._own(
            db, LearningTrack, payload.track_id, workspace_id, space_id, context.user.id
        )
        if parent is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Learning track not found.", status_code=404
            )
        item = StudyProject(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            track_id=payload.track_id,
            title=payload.title,
            intended_outcome=payload.intended_outcome,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        await self._add(
            db,
            context,
            item,
            workspace_id,
            request_id,
            "self_study.project_created",
            "study_project",
        )
        return item

    async def create_inbox_item(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: InboxItemCreateRequest,
        request_id: str,
    ) -> InboxItem:
        await self._boundary(db, context, workspace_id, space_id, request_id)
        await self._quota(db, InboxItem, workspace_id, context.user.id)
        await self._ensure_new(db, InboxItem, payload.id)
        item = InboxItem(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            title=payload.title,
            note=payload.note,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        await self._add(
            db, context, item, workspace_id, request_id, "self_study.inbox_captured", "inbox_item"
        )
        return item

    async def create_deliverable(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: DeliverableCreateRequest,
        request_id: str,
    ) -> Deliverable:
        await self._boundary(db, context, workspace_id, space_id, request_id)
        await self._quota(db, Deliverable, workspace_id, context.user.id)
        await self._ensure_new(db, Deliverable, payload.id)
        parent = await self._own(
            db, StudyProject, payload.project_id, workspace_id, space_id, context.user.id
        )
        if parent is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Study project not found.", status_code=404
            )
        item = Deliverable(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            project_id=payload.project_id,
            title=payload.title,
            evidence_summary=payload.evidence_summary,
            completed_at=payload.completed_at,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        await self._add(
            db,
            context,
            item,
            workspace_id,
            request_id,
            "self_study.deliverable_recorded",
            "deliverable",
        )
        return item

    async def list_all(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> tuple[list[LearningTrack], list[StudyProject], list[InboxItem], list[Deliverable]]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )

        async def rows(
            model: type[LearningTrack] | type[StudyProject] | type[InboxItem] | type[Deliverable],
        ) -> list[Any]:
            return list(
                (
                    await db.scalars(
                        select(model)
                        .where(
                            model.workspace_id == workspace_id,
                            model.space_id == space_id,
                            model.user_id == context.user.id,
                            model.deleted_at.is_(None),
                        )
                        .order_by(model.id)
                        .limit(10000)
                    )
                ).all()
            )

        return (
            await rows(LearningTrack),
            await rows(StudyProject),
            await rows(InboxItem),
            await rows(Deliverable),
        )

    async def _ensure_new(
        self,
        db: AsyncSession,
        model: type[LearningTrack] | type[StudyProject] | type[InboxItem] | type[Deliverable],
        entity_id: UUID,
    ) -> None:
        if await db.get(model, entity_id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )

    async def _own(
        self,
        db: AsyncSession,
        model: type[LearningTrack] | type[StudyProject],
        entity_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        user_id: UUID,
    ) -> LearningTrack | StudyProject | None:
        return cast(
            LearningTrack | StudyProject | None,
            await db.scalar(
                select(model).where(
                    model.id == entity_id,
                    model.workspace_id == workspace_id,
                    model.space_id == space_id,
                    model.user_id == user_id,
                    model.deleted_at.is_(None),
                )
            ),
        )

    async def _add(
        self,
        db: AsyncSession,
        context: AuthContext,
        item: LearningTrack | StudyProject | InboxItem | Deliverable,
        workspace_id: UUID,
        request_id: str,
        event_type: str,
        target_type: str,
    ) -> None:
        db.add(item)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=event_type,
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type=target_type,
                target_id=item.id,
                metadata={},
            )
        )
