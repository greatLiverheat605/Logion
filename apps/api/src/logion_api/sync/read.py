from typing import Literal, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.execution.models import StudySession, Task
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.sync.models import SyncChange, WorkspaceSyncState
from logion_api.sync.push import canonical_hash, session_payload, task_payload
from logion_api.sync.schemas import BootstrapResponse, Change, EntityRecord, PullResponse
from logion_api.workspaces.models import Space


class SyncReadService:
    async def pull(
        self,
        db: AsyncSession,
        state: WorkspaceSyncState,
        *,
        device_id: UUID,
        user_id: UUID,
        cursor: int,
        limit: int,
    ) -> PullResponse:
        rows = list(
            (
                await db.scalars(
                    select(SyncChange)
                    .where(
                        SyncChange.workspace_id == state.workspace_id,
                        SyncChange.sync_epoch == state.sync_epoch,
                        SyncChange.sequence > cursor,
                    )
                    .order_by(SyncChange.sequence)
                    .limit(limit + 1)
                )
            ).all()
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        visible_spaces = await self._visible_space_ids(
            db,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "space"},
        )
        visible_goals = await self._visible_goal_ids(
            db,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "learning_goal"},
        )
        visible_tasks = await self._visible_task_ids(
            db,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "task"},
        )
        visible_sessions = await self._visible_session_ids(
            db,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "study_session"},
        )
        changes = [
            Change(
                sequence=row.sequence,
                operation_id=row.operation_id,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                operation_type=cast(
                    Literal["create", "update", "delete", "restore"],
                    row.operation_type,
                ),
                server_version=row.server_version,
                occurred_at=row.occurred_at,
                tombstone=row.tombstone,
                deleted_at=row.deleted_at,
                payload=row.payload,
                payload_hash=row.payload_hash,
            )
            for row in page
            if (row.entity_type == "space" and row.entity_id in visible_spaces)
            or (row.entity_type == "learning_goal" and row.entity_id in visible_goals)
            or (row.entity_type == "task" and row.entity_id in visible_tasks)
            or (row.entity_type == "study_session" and row.entity_id in visible_sessions)
        ]
        return PullResponse(
            workspace_id=state.workspace_id,
            device_id=device_id,
            sync_epoch=state.sync_epoch,
            from_cursor=cursor,
            next_cursor=page[-1].sequence if page else cursor,
            has_more=has_more,
            changes=changes,
        )

    async def bootstrap(
        self,
        db: AsyncSession,
        state: WorkspaceSyncState,
        *,
        device_id: UUID,
        user_id: UUID,
        requested_snapshot_id: UUID | None,
        chunk_index: int | None,
        chunk_size: int = 100,
    ) -> BootstrapResponse:
        records = [
            *(await self._space_records(db, state.workspace_id, user_id)),
            *(await self._goal_records(db, state.workspace_id, user_id)),
            *(await self._task_records(db, state.workspace_id, user_id)),
            *(await self._session_records(db, state.workspace_id, user_id)),
        ]
        chunks = [
            records[index : index + chunk_size] for index in range(0, len(records), chunk_size)
        ]
        if not chunks:
            chunks = [[]]
        checksums = [
            canonical_hash([record.model_dump(mode="json") for record in chunk]) for chunk in chunks
        ]
        manifest = {
            "chunks": [
                {"chunk_index": index, "chunk_checksum": checksum}
                for index, checksum in enumerate(checksums)
            ]
        }
        snapshot_checksum = canonical_hash(manifest)
        snapshot_id = uuid5(
            NAMESPACE_URL,
            f"logion:{state.workspace_id}:{state.sync_epoch}:{state.last_sequence}:{snapshot_checksum}",
        )
        if requested_snapshot_id is not None and requested_snapshot_id != snapshot_id:
            raise StaleSnapshotError
        selected = chunk_index or 0
        if selected >= len(chunks):
            raise InvalidChunkError
        return BootstrapResponse(
            workspace_id=state.workspace_id,
            device_id=device_id,
            sync_epoch=state.sync_epoch,
            snapshot_id=snapshot_id,
            chunk_index=selected,
            chunk_count=len(chunks),
            cursor=state.last_sequence,
            snapshot_checksum=snapshot_checksum,
            chunk_checksum=checksums[selected],
            records=chunks[selected],
            created_at=state.updated_at,
        )

    async def _space_records(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        spaces = list(
            (
                await db.scalars(
                    select(Space)
                    .where(
                        Space.workspace_id == workspace_id,
                        Space.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(Space.id)
                )
            ).all()
        )
        return [
            EntityRecord(
                entity_type="space",
                entity_id=space.id,
                version=space.version,
                created_at=space.created_at,
                updated_at=space.updated_at,
                deleted_at=space.deleted_at,
                created_by=space.created_by,
                updated_by=space.updated_by,
                payload={"name": space.name, "visibility": space.visibility},
                payload_hash=canonical_hash({"name": space.name, "visibility": space.visibility}),
            )
            for space in spaces
        ]

    async def _visible_space_ids(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        return set(
            (
                await db.scalars(
                    select(Space.id).where(
                        Space.workspace_id == workspace_id,
                        Space.id.in_(entity_ids),
                        Space.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                )
            ).all()
        )

    async def _visible_goal_ids(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        return set(
            (
                await db.scalars(
                    select(LearningGoal.id)
                    .join(Space, Space.id == LearningGoal.space_id)
                    .where(
                        LearningGoal.workspace_id == workspace_id,
                        LearningGoal.id.in_(entity_ids),
                        LearningGoal.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                )
            ).all()
        )

    async def _goal_records(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        goals = list(
            (
                await db.scalars(
                    select(LearningGoal)
                    .join(Space, Space.id == LearningGoal.space_id)
                    .where(
                        LearningGoal.workspace_id == workspace_id,
                        LearningGoal.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(LearningGoal.id)
                )
            ).all()
        )
        if not goals:
            return []
        plans = list(
            (
                await db.scalars(
                    select(LearningPlan).where(
                        LearningPlan.goal_id.in_([goal.id for goal in goals])
                    )
                )
            ).all()
        )
        versions = list(
            (
                await db.scalars(
                    select(PlanVersion).where(PlanVersion.plan_id.in_([plan.id for plan in plans]))
                )
            ).all()
        )
        phases = list(
            (
                await db.scalars(
                    select(PlanPhase)
                    .where(PlanPhase.plan_version_id.in_([version.id for version in versions]))
                    .order_by(PlanPhase.position)
                )
            ).all()
        )
        plan_by_goal = {plan.goal_id: plan for plan in plans}
        version_by_plan = {version.plan_id: version for version in versions}
        phases_by_version: dict[UUID, list[PlanPhase]] = {}
        for phase in phases:
            phases_by_version.setdefault(phase.plan_version_id, []).append(phase)
        records: list[EntityRecord] = []
        for goal in goals:
            plan = plan_by_goal.get(goal.id)
            version = version_by_plan.get(plan.id) if plan is not None else None
            if plan is None or version is None:
                continue
            payload = {
                "space_id": str(goal.space_id),
                "plan_id": str(plan.id),
                "plan_version_id": str(version.id),
                "title": goal.title,
                "description": goal.description,
                "desired_outcome": goal.desired_outcome,
                "weekly_minutes": goal.weekly_minutes,
                "target_date": goal.target_date.isoformat() if goal.target_date else None,
                "phases": [
                    {
                        "id": str(phase.id),
                        "title": phase.title,
                        "description": phase.description,
                        "position": phase.position,
                        "estimated_minutes": phase.estimated_minutes,
                        "acceptance_criteria": phase.acceptance_criteria,
                    }
                    for phase in phases_by_version.get(version.id, [])
                ],
            }
            records.append(
                EntityRecord(
                    entity_type="learning_goal",
                    entity_id=goal.id,
                    version=goal.version,
                    created_at=goal.created_at,
                    updated_at=goal.updated_at,
                    deleted_at=goal.deleted_at,
                    created_by=goal.created_by,
                    updated_by=goal.updated_by,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        return records

    async def _visible_task_ids(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        return set(
            (
                await db.scalars(
                    select(Task.id)
                    .join(Space, Space.id == Task.space_id)
                    .where(
                        Task.workspace_id == workspace_id,
                        Task.id.in_(entity_ids),
                        Task.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                )
            ).all()
        )

    async def _visible_session_ids(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        return set(
            (
                await db.scalars(
                    select(StudySession.id)
                    .join(Space, Space.id == StudySession.space_id)
                    .where(
                        StudySession.workspace_id == workspace_id,
                        StudySession.id.in_(entity_ids),
                        StudySession.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                )
            ).all()
        )

    async def _task_records(
        self, db: AsyncSession, workspace_id: UUID, user_id: UUID
    ) -> list[EntityRecord]:
        tasks = list(
            (
                await db.scalars(
                    select(Task)
                    .join(Space, Space.id == Task.space_id)
                    .where(
                        Task.workspace_id == workspace_id,
                        Task.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(Task.id)
                )
            ).all()
        )
        return [
            EntityRecord(
                entity_type="task",
                entity_id=task.id,
                version=task.version,
                created_at=task.created_at,
                updated_at=task.updated_at,
                deleted_at=task.deleted_at,
                created_by=task.created_by,
                updated_by=task.updated_by,
                payload=task_payload(task),
                payload_hash=canonical_hash(task_payload(task)),
            )
            for task in tasks
        ]

    async def _session_records(
        self, db: AsyncSession, workspace_id: UUID, user_id: UUID
    ) -> list[EntityRecord]:
        sessions = list(
            (
                await db.scalars(
                    select(StudySession)
                    .join(Space, Space.id == StudySession.space_id)
                    .where(
                        StudySession.workspace_id == workspace_id,
                        StudySession.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(StudySession.id)
                )
            ).all()
        )
        return [
            EntityRecord(
                entity_type="study_session",
                entity_id=session.id,
                version=session.version,
                created_at=session.created_at,
                updated_at=session.updated_at,
                deleted_at=session.deleted_at,
                created_by=session.created_by,
                updated_by=session.updated_by,
                payload=session_payload(session),
                payload_hash=canonical_hash(session_payload(session)),
            )
            for session in sessions
        ]


class StaleSnapshotError(Exception):
    pass


class InvalidChunkError(Exception):
    pass
