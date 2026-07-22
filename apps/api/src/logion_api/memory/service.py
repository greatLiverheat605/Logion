from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.memory.models import MasteryRecord, ReviewSchedule, Topic, TopicDependency
from logion_api.memory.schemas import (
    MasteryConfirmRequest,
    MasteryLevel,
    TopicCreateRequest,
    TopicDependencyCreateRequest,
)
from logion_api.workspaces.models import Space, WorkspaceMembership
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

REVIEW_INTERVAL_DAYS: dict[str, int] = {
    "unknown": 1,
    "exposed": 1,
    "practicing": 2,
    "familiar": 4,
    "proficient": 7,
    "mastered": 14,
}


@dataclass(frozen=True)
class TopicView:
    topic: Topic
    mastery: MasteryRecord | None
    review_schedule: ReviewSchedule | None


@dataclass(frozen=True)
class MasteryConfirmation:
    mastery: MasteryRecord
    review_schedule: ReviewSchedule


class MemoryService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    async def _resolve_space(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
        *,
        shared_write: bool,
    ) -> Space:
        space = await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if shared_write and space.visibility == "shared":
            await self._workspaces.resolve_workspace(
                db,
                context,
                workspace_id,
                request_id=request_id,
                permission=Permission.SHARED_PLAN_WRITE,
            )
        return space

    async def create_topic(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: TopicCreateRequest,
        request_id: str,
    ) -> Topic:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=True
        )
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        count = int(
            await db.scalar(
                select(func.count(Topic.id)).where(
                    Topic.workspace_id == workspace_id,
                    Topic.space_id == space_id,
                    Topic.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.topic_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The Space has reached its topic limit.",
                status_code=409,
            )
        if await db.get(Topic, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        topic = Topic(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            title=payload.title,
            description=payload.description,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(topic)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.topic_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="topic",
                target_id=topic.id,
            )
        )
        return topic

    async def list_topics(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[TopicView]:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        topics = list(
            (
                await db.scalars(
                    select(Topic)
                    .where(
                        Topic.workspace_id == workspace_id,
                        Topic.space_id == space_id,
                        Topic.deleted_at.is_(None),
                    )
                    .order_by(Topic.updated_at.desc(), Topic.id)
                )
            ).all()
        )
        if not topics:
            return []
        topic_ids = [topic.id for topic in topics]
        mastery = list(
            (
                await db.scalars(
                    select(MasteryRecord).where(
                        MasteryRecord.workspace_id == workspace_id,
                        MasteryRecord.user_id == context.user.id,
                        MasteryRecord.topic_id.in_(topic_ids),
                        MasteryRecord.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        schedules = list(
            (
                await db.scalars(
                    select(ReviewSchedule).where(
                        ReviewSchedule.workspace_id == workspace_id,
                        ReviewSchedule.user_id == context.user.id,
                        ReviewSchedule.topic_id.in_(topic_ids),
                        ReviewSchedule.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        mastery_by_topic = {item.topic_id: item for item in mastery}
        schedule_by_topic = {item.topic_id: item for item in schedules}
        return [
            TopicView(topic, mastery_by_topic.get(topic.id), schedule_by_topic.get(topic.id))
            for topic in topics
        ]

    async def add_dependency(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: TopicDependencyCreateRequest,
        request_id: str,
    ) -> TopicDependency:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=True
        )
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        topics = list(
            (
                await db.scalars(
                    select(Topic).where(
                        Topic.workspace_id == workspace_id,
                        Topic.space_id == space_id,
                        Topic.id.in_(
                            [payload.prerequisite_topic_id, payload.dependent_topic_id]
                        ),
                        Topic.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        if len(topics) != 2:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if await db.get(TopicDependency, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        edge_rows = list(
            (
                await db.execute(
                    select(
                        TopicDependency.prerequisite_topic_id,
                        TopicDependency.dependent_topic_id,
                    ).where(
                        TopicDependency.workspace_id == workspace_id,
                        TopicDependency.space_id == space_id,
                        TopicDependency.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        edges = {(source, target) for source, target in edge_rows}
        if (payload.prerequisite_topic_id, payload.dependent_topic_id) in edges:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The dependency already exists.",
                status_code=409,
            )
        adjacency: dict[UUID, set[UUID]] = {}
        for source, target in edges:
            adjacency.setdefault(source, set()).add(target)
        pending = [payload.dependent_topic_id]
        visited: set[UUID] = set()
        while pending:
            current = pending.pop()
            if current == payload.prerequisite_topic_id:
                raise APIError(
                    code="RESOURCE_STATE_CONFLICT",
                    message="The dependency would create a cycle.",
                    status_code=409,
                )
            if current in visited:
                continue
            visited.add(current)
            pending.extend(adjacency.get(current, ()))
        dependency = TopicDependency(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            prerequisite_topic_id=payload.prerequisite_topic_id,
            dependent_topic_id=payload.dependent_topic_id,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(dependency)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.topic_dependency_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="topic_dependency",
                target_id=dependency.id,
                metadata={
                    "prerequisite_topic_id": str(dependency.prerequisite_topic_id),
                    "dependent_topic_id": str(dependency.dependent_topic_id),
                },
            )
        )
        return dependency

    async def confirm_mastery(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        topic_id: UUID,
        payload: MasteryConfirmRequest,
        request_id: str,
    ) -> MasteryConfirmation:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        topic = await db.scalar(
            select(Topic)
            .where(
                Topic.id == topic_id,
                Topic.workspace_id == workspace_id,
                Topic.space_id == space_id,
                Topic.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if topic is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        mastery = await db.scalar(
            select(MasteryRecord)
            .where(
                MasteryRecord.workspace_id == workspace_id,
                MasteryRecord.topic_id == topic_id,
                MasteryRecord.user_id == context.user.id,
                MasteryRecord.deleted_at.is_(None),
            )
            .with_for_update()
        )
        now = utc_now()
        if mastery is None:
            if payload.expected_version != 0 or (
                await db.get(MasteryRecord, payload.mastery_id)
            ) is not None:
                raise APIError(
                    code="RESOURCE_VERSION_CONFLICT",
                    message="The mastery record changed.",
                    status_code=409,
                )
            mastery = MasteryRecord(
                id=payload.mastery_id,
                workspace_id=workspace_id,
                space_id=space_id,
                topic_id=topic_id,
                user_id=context.user.id,
                created_by=context.user.id,
                updated_by=context.user.id,
            )
            db.add(mastery)
        elif mastery.id != payload.mastery_id or mastery.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The mastery record changed.",
                status_code=409,
            )
        else:
            mastery.version += 1
        mastery.confirmed_level = payload.confirmed_level
        mastery.confirmed_by = context.user.id
        mastery.confirmed_at = now
        mastery.updated_by = context.user.id
        mastery.updated_at = now

        schedule = await db.scalar(
            select(ReviewSchedule)
            .where(
                ReviewSchedule.workspace_id == workspace_id,
                ReviewSchedule.topic_id == topic_id,
                ReviewSchedule.user_id == context.user.id,
                ReviewSchedule.deleted_at.is_(None),
            )
            .with_for_update()
        )
        interval = REVIEW_INTERVAL_DAYS[payload.confirmed_level]
        if schedule is None:
            if await db.get(ReviewSchedule, payload.schedule_id) is not None:
                raise APIError(
                    code="RESOURCE_VERSION_CONFLICT",
                    message="The review schedule changed.",
                    status_code=409,
                )
            schedule = ReviewSchedule(
                id=payload.schedule_id,
                workspace_id=workspace_id,
                space_id=space_id,
                topic_id=topic_id,
                user_id=context.user.id,
                source="mastery_confirmation",
                interval_days=interval,
                next_review_at=now + timedelta(days=interval),
                created_by=context.user.id,
                updated_by=context.user.id,
            )
            db.add(schedule)
        elif schedule.id != payload.schedule_id:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The review schedule changed.",
                status_code=409,
            )
        else:
            schedule.status = "scheduled"
            schedule.source = "mastery_confirmation"
            schedule.interval_days = interval
            schedule.next_review_at = now + timedelta(days=interval)
            schedule.version += 1
            schedule.updated_by = context.user.id
            schedule.updated_at = now
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.mastery_confirmed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="mastery",
                target_id=mastery.id,
                metadata={
                    "confirmed_level": mastery.confirmed_level,
                    "version": mastery.version,
                    "review_interval_days": interval,
                },
            )
        )
        return MasteryConfirmation(mastery, schedule)

    async def record_system_suggestion(
        self,
        db: AsyncSession,
        *,
        workspace_id: UUID,
        space_id: UUID,
        topic_id: UUID,
        user_id: UUID,
        mastery_id: UUID,
        expected_version: int,
        suggested_level: MasteryLevel,
        suggested_reason: str,
        request_id: str,
    ) -> MasteryRecord:
        if len(suggested_reason) > 500:
            raise ValueError("suggested_reason exceeds 500 characters")
        topic = await db.scalar(
            select(Topic).where(
                Topic.id == topic_id,
                Topic.workspace_id == workspace_id,
                Topic.space_id == space_id,
                Topic.deleted_at.is_(None),
            )
        )
        if topic is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        space = await db.get(Space, space_id)
        if space is None or space.workspace_id != workspace_id:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if space.visibility == "private":
            target_allowed = space.owner_user_id == user_id
        else:
            target_allowed = (
                await db.scalar(
                    select(WorkspaceMembership.id).where(
                        WorkspaceMembership.workspace_id == workspace_id,
                        WorkspaceMembership.user_id == user_id,
                        WorkspaceMembership.status == "active",
                    )
                )
            ) is not None
        if not target_allowed:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        mastery = await db.scalar(
            select(MasteryRecord)
            .where(
                MasteryRecord.workspace_id == workspace_id,
                MasteryRecord.topic_id == topic_id,
                MasteryRecord.user_id == user_id,
                MasteryRecord.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if mastery is None:
            if expected_version != 0 or (
                await db.get(MasteryRecord, mastery_id)
            ) is not None:
                raise APIError(
                    code="RESOURCE_VERSION_CONFLICT",
                    message="The mastery record changed.",
                    status_code=409,
                )
            mastery = MasteryRecord(
                id=mastery_id,
                workspace_id=workspace_id,
                space_id=space_id,
                topic_id=topic_id,
                user_id=user_id,
            )
            db.add(mastery)
        elif mastery.id != mastery_id or mastery.version != expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The mastery record changed.",
                status_code=409,
            )
        else:
            mastery.version += 1
        mastery.suggested_level = suggested_level
        mastery.suggested_reason = suggested_reason
        mastery.suggested_at = utc_now()
        mastery.updated_at = mastery.suggested_at
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.mastery_suggested",
                result="success",
                workspace_id=workspace_id,
                target_type="mastery",
                target_id=mastery.id,
                metadata={"suggested_level": suggested_level, "version": mastery.version},
            )
        )
        return mastery
