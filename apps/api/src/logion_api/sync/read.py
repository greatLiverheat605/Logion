from typing import Any, Literal, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.collaboration.models import GroupFeedback, ReportSnapshot, ReviewRequest, Rubric
from logion_api.content.models import Note, Resource
from logion_api.exam.models import Exam, MockExam, ScoreRecord, Subject, SyllabusNode
from logion_api.execution.evidence_models import EvidenceItem, VerificationRecord
from logion_api.execution.models import StudySession, Task
from logion_api.memory.models import (
    AuditReview,
    ErrorPattern,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewFinding,
    ReviewSchedule,
    Topic,
    TopicDependency,
)
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.research.models import (
    ExperimentRun,
    MetricRecord,
    PaperRecord,
    ResearchClaim,
    ResearchFeedback,
    ResearchQuestion,
)
from logion_api.self_study.models import Deliverable, InboxItem, LearningTrack, StudyProject
from logion_api.sync.models import SyncChange, WorkspaceSyncState
from logion_api.sync.push import (
    audit_review_payload,
    canonical_hash,
    collaboration_payload,
    error_pattern_payload,
    evidence_payload,
    exam_payload,
    exam_subject_payload,
    mastery_payload,
    mock_exam_payload,
    note_payload,
    quiz_attempt_payload,
    quiz_item_payload,
    research_payload,
    resource_payload,
    review_finding_payload,
    review_schedule_payload,
    score_record_payload,
    self_study_payload,
    session_payload,
    syllabus_node_payload,
    task_payload,
    topic_dependency_payload,
    topic_payload,
    verification_payload,
)
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
        visible_notes = await self._visible_content_ids(
            db,
            Note,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "note"},
        )
        visible_resources = await self._visible_content_ids(
            db,
            Resource,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "resource"},
        )
        visible_evidence = await self._visible_verification_ids(
            db,
            EvidenceItem,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "evidence"},
        )
        visible_verifications = await self._visible_verification_ids(
            db,
            VerificationRecord,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "verification"},
        )
        visible_topics = await self._visible_memory_ids(
            db,
            Topic,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "topic"},
        )
        visible_dependencies = await self._visible_memory_ids(
            db,
            TopicDependency,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "topic_dependency"},
        )
        visible_mastery = await self._visible_personal_memory_ids(
            db,
            MasteryRecord,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "mastery"},
        )
        visible_schedules = await self._visible_personal_memory_ids(
            db,
            ReviewSchedule,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "review_schedule"},
        )
        visible_quiz_items = await self._visible_memory_ids(
            db,
            QuizItem,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "quiz_item"},
        )
        personal_models = (
            ("quiz_attempt", QuizAttempt),
            ("error_pattern", ErrorPattern),
            ("audit_review", AuditReview),
            ("review_finding", ReviewFinding),
        )
        personal_visible: dict[str, set[UUID]] = {}
        for entity_type, model in personal_models:
            personal_visible[entity_type] = await self._visible_personal_memory_ids(
                db,
                model,
                state.workspace_id,
                user_id,
                {row.entity_id for row in page if row.entity_type == entity_type},
            )
        visible_exams = await self._visible_personal_memory_ids(
            db,
            Exam,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "exam"},
        )
        visible_subjects = await self._visible_personal_memory_ids(
            db,
            Subject,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "exam_subject"},
        )
        visible_syllabus_nodes = await self._visible_personal_memory_ids(
            db,
            SyllabusNode,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "syllabus_node"},
        )
        visible_mock_exams = await self._visible_personal_memory_ids(
            db,
            MockExam,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "mock_exam"},
        )
        visible_score_records = await self._visible_personal_memory_ids(
            db,
            ScoreRecord,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "score_record"},
        )
        visible_self_study: dict[str, set[UUID]] = {}
        for entity_type, self_study_model in (
            ("learning_track", LearningTrack),
            ("study_project", StudyProject),
            ("inbox_item", InboxItem),
            ("deliverable", Deliverable),
        ):
            visible_self_study[entity_type] = await self._visible_personal_memory_ids(
                db,
                cast(Any, self_study_model),
                state.workspace_id,
                user_id,
                {row.entity_id for row in page if row.entity_type == entity_type},
            )
        visible_research: dict[str, set[UUID]] = {}
        for entity_type, research_model in (
            ("paper_record", PaperRecord),
            ("research_claim", ResearchClaim),
            ("research_question", ResearchQuestion),
            ("experiment_run", ExperimentRun),
            ("metric_record", MetricRecord),
            ("research_feedback", ResearchFeedback),
        ):
            visible_research[entity_type] = await self._visible_personal_memory_ids(
                db,
                cast(Any, research_model),
                state.workspace_id,
                user_id,
                {row.entity_id for row in page if row.entity_type == entity_type},
            )
        visible_collaboration: dict[str, set[UUID]] = {}
        for entity_type, shared_model in (
            ("rubric", Rubric),
            ("group_review", ReviewRequest),
            ("group_feedback", GroupFeedback),
            ("report_snapshot", ReportSnapshot),
        ):
            visible_collaboration[entity_type] = await self._visible_shared_ids(
                db,
                cast(Any, shared_model),
                state.workspace_id,
                {row.entity_id for row in page if row.entity_type == entity_type},
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
            or (row.entity_type == "note" and row.entity_id in visible_notes)
            or (row.entity_type == "resource" and row.entity_id in visible_resources)
            or (row.entity_type == "evidence" and row.entity_id in visible_evidence)
            or (row.entity_type == "verification" and row.entity_id in visible_verifications)
            or (row.entity_type == "topic" and row.entity_id in visible_topics)
            or (row.entity_type == "topic_dependency" and row.entity_id in visible_dependencies)
            or (row.entity_type == "mastery" and row.entity_id in visible_mastery)
            or (row.entity_type == "review_schedule" and row.entity_id in visible_schedules)
            or (row.entity_type == "quiz_item" and row.entity_id in visible_quiz_items)
            or (
                row.entity_type in personal_visible
                and row.entity_id in personal_visible[row.entity_type]
            )
            or (row.entity_type == "exam" and row.entity_id in visible_exams)
            or (row.entity_type == "exam_subject" and row.entity_id in visible_subjects)
            or (row.entity_type == "syllabus_node" and row.entity_id in visible_syllabus_nodes)
            or (row.entity_type == "mock_exam" and row.entity_id in visible_mock_exams)
            or (row.entity_type == "score_record" and row.entity_id in visible_score_records)
            or (
                row.entity_type in visible_self_study
                and row.entity_id in visible_self_study[row.entity_type]
            )
            or (
                row.entity_type in visible_research
                and row.entity_id in visible_research[row.entity_type]
            )
            or (
                row.entity_type in visible_collaboration
                and row.entity_id in visible_collaboration[row.entity_type]
            )
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
            *(await self._content_records(db, Note, state.workspace_id, user_id)),
            *(await self._content_records(db, Resource, state.workspace_id, user_id)),
            *(await self._verification_records(db, EvidenceItem, state.workspace_id, user_id)),
            *(
                await self._verification_records(
                    db, VerificationRecord, state.workspace_id, user_id
                )
            ),
            *(await self._memory_records(db, Topic, state.workspace_id, user_id)),
            *(await self._memory_records(db, TopicDependency, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, MasteryRecord, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, ReviewSchedule, state.workspace_id, user_id)),
            *(await self._memory_records(db, QuizItem, state.workspace_id, user_id)),
            *(await self._quiz_attempt_records(db, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, ErrorPattern, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, AuditReview, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, ReviewFinding, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, Exam, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, Subject, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, SyllabusNode, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, MockExam, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, ScoreRecord, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, LearningTrack, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, StudyProject, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, InboxItem, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, Deliverable, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, PaperRecord, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, ResearchClaim, state.workspace_id, user_id)),
            *(
                await self._personal_memory_records(
                    db, ResearchQuestion, state.workspace_id, user_id
                )
            ),
            *(await self._personal_memory_records(db, ExperimentRun, state.workspace_id, user_id)),
            *(await self._personal_memory_records(db, MetricRecord, state.workspace_id, user_id)),
            *(
                await self._personal_memory_records(
                    db, ResearchFeedback, state.workspace_id, user_id
                )
            ),
            *(await self._shared_collaboration_records(db, Rubric, state.workspace_id)),
            *(await self._shared_collaboration_records(db, ReviewRequest, state.workspace_id)),
            *(await self._shared_collaboration_records(db, GroupFeedback, state.workspace_id)),
            *(await self._shared_collaboration_records(db, ReportSnapshot, state.workspace_id)),
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

    async def _visible_content_ids(
        self,
        db: AsyncSession,
        model: type[Note] | type[Resource],
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        if model is Note:
            statement = (
                select(Note.id)
                .join(Space, Space.id == Note.space_id)
                .where(
                    Note.workspace_id == workspace_id,
                    Note.id.in_(entity_ids),
                    Note.deleted_at.is_(None),
                    (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                )
            )
        else:
            statement = (
                select(Resource.id)
                .join(Space, Space.id == Resource.space_id)
                .where(
                    Resource.workspace_id == workspace_id,
                    Resource.id.in_(entity_ids),
                    Resource.deleted_at.is_(None),
                    (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                )
            )
        return set((await db.scalars(statement)).all())

    async def _content_records(
        self,
        db: AsyncSession,
        model: type[Note] | type[Resource],
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        if model is Note:
            notes = list(
                (
                    await db.scalars(
                        select(Note)
                        .join(Space, Space.id == Note.space_id)
                        .where(
                            Note.workspace_id == workspace_id,
                            Note.deleted_at.is_(None),
                            (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                        )
                        .order_by(Note.id)
                    )
                ).all()
            )
            return [
                EntityRecord(
                    entity_type="note",
                    entity_id=item.id,
                    version=item.version,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                    deleted_at=item.deleted_at,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    payload=note_payload(item),
                    payload_hash=canonical_hash(note_payload(item)),
                )
                for item in notes
            ]
        resources = list(
            (
                await db.scalars(
                    select(Resource)
                    .join(Space, Space.id == Resource.space_id)
                    .where(
                        Resource.workspace_id == workspace_id,
                        Resource.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(Resource.id)
                )
            ).all()
        )
        return [
            EntityRecord(
                entity_type="resource",
                entity_id=item.id,
                version=item.version,
                created_at=item.created_at,
                updated_at=item.updated_at,
                deleted_at=item.deleted_at,
                created_by=item.created_by,
                updated_by=item.updated_by,
                payload=resource_payload(item),
                payload_hash=canonical_hash(resource_payload(item)),
            )
            for item in resources
        ]

    async def _visible_verification_ids(
        self,
        db: AsyncSession,
        model: type[EvidenceItem] | type[VerificationRecord],
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        statement = (
            select(model.id)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.id.in_(entity_ids),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
        )
        if model is EvidenceItem:
            statement = statement.where(EvidenceItem.deleted_at.is_(None))
        return set((await db.scalars(statement)).all())

    async def _verification_records(
        self,
        db: AsyncSession,
        model: type[EvidenceItem] | type[VerificationRecord],
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        statement = (
            select(model)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
            .order_by(model.id)
        )
        if model is EvidenceItem:
            statement = statement.where(EvidenceItem.deleted_at.is_(None))
        items = cast(
            list[EvidenceItem | VerificationRecord],
            list((await db.scalars(statement)).all()),
        )
        records: list[EntityRecord] = []
        for item in items:
            if isinstance(item, EvidenceItem):
                payload = evidence_payload(item)
                entity_type = "evidence"
                deleted_at = item.deleted_at
                created_by = item.created_by
                updated_by = item.updated_by
            else:
                payload = verification_payload(item)
                entity_type = "verification"
                deleted_at = None
                created_by = item.requested_by
                updated_by = item.decided_by or item.requested_by
            records.append(
                EntityRecord(
                    entity_type=entity_type,
                    entity_id=item.id,
                    version=item.version,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                    deleted_at=deleted_at,
                    created_by=created_by,
                    updated_by=updated_by,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        return records

    async def _visible_memory_ids(
        self,
        db: AsyncSession,
        model: type[Topic]
        | type[TopicDependency]
        | type[QuizItem]
        | type[Rubric]
        | type[ReviewRequest]
        | type[GroupFeedback]
        | type[ReportSnapshot],
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        statement = (
            select(model.id)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.id.in_(entity_ids),
                model.deleted_at.is_(None),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
        )
        return set((await db.scalars(statement)).all())

    async def _visible_personal_memory_ids(
        self,
        db: AsyncSession,
        model: (
            type[MasteryRecord]
            | type[ReviewSchedule]
            | type[QuizAttempt]
            | type[ErrorPattern]
            | type[AuditReview]
            | type[ReviewFinding]
            | type[Exam]
            | type[Subject]
            | type[SyllabusNode]
            | type[MockExam]
            | type[ScoreRecord]
            | type[LearningTrack]
            | type[StudyProject]
            | type[InboxItem]
            | type[Deliverable]
            | type[PaperRecord]
            | type[ResearchClaim]
            | type[ResearchQuestion]
            | type[ExperimentRun]
            | type[MetricRecord]
            | type[ResearchFeedback]
        ),
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        statement = (
            select(model.id)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.user_id == user_id,
                model.id.in_(entity_ids),
                model.deleted_at.is_(None),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
        )
        return set((await db.scalars(statement)).all())

    async def _visible_shared_ids(
        self,
        db: AsyncSession,
        model: type[Rubric] | type[ReviewRequest] | type[GroupFeedback] | type[ReportSnapshot],
        workspace_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        statement = (
            select(model.id)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.id.in_(entity_ids),
                model.deleted_at.is_(None),
                Space.visibility == "shared",
            )
        )
        return set((await db.scalars(statement)).all())

    async def _shared_collaboration_records(
        self,
        db: AsyncSession,
        model: type[Rubric] | type[ReviewRequest] | type[GroupFeedback] | type[ReportSnapshot],
        workspace_id: UUID,
    ) -> list[EntityRecord]:
        items = cast(
            list[Rubric | ReviewRequest | GroupFeedback | ReportSnapshot],
            list(
                (
                    await db.scalars(
                        select(model)
                        .join(Space, Space.id == model.space_id)
                        .where(
                            model.workspace_id == workspace_id,
                            model.deleted_at.is_(None),
                            Space.visibility == "shared",
                        )
                        .order_by(model.id)
                    )
                ).all()
            ),
        )
        entity_types = {
            Rubric: "rubric",
            ReviewRequest: "group_review",
            GroupFeedback: "group_feedback",
            ReportSnapshot: "report_snapshot",
        }
        return [
            EntityRecord(
                entity_type=entity_types[type(item)],
                entity_id=item.id,
                version=item.version,
                created_at=item.created_at,
                updated_at=item.updated_at,
                deleted_at=item.deleted_at,
                created_by=item.created_by,
                updated_by=item.updated_by,
                payload=collaboration_payload(item),
                payload_hash=canonical_hash(collaboration_payload(item)),
            )
            for item in items
        ]

    async def _memory_records(
        self,
        db: AsyncSession,
        model: type[Topic] | type[TopicDependency] | type[QuizItem],
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        statement = (
            select(model)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.deleted_at.is_(None),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
            .order_by(model.id)
        )
        items = cast(
            list[Topic | TopicDependency | QuizItem],
            list((await db.scalars(statement)).all()),
        )
        records: list[EntityRecord] = []
        for item in items:
            if isinstance(item, Topic):
                entity_type = "topic"
                payload = topic_payload(item)
            elif isinstance(item, TopicDependency):
                entity_type = "topic_dependency"
                payload = topic_dependency_payload(item)
            else:
                entity_type = "quiz_item"
                payload = quiz_item_payload(item)
            records.append(
                EntityRecord(
                    entity_type=entity_type,
                    entity_id=item.id,
                    version=item.version,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                    deleted_at=item.deleted_at,
                    created_by=item.created_by,
                    updated_by=item.updated_by,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        return records

    async def _personal_memory_records(
        self,
        db: AsyncSession,
        model: (
            type[MasteryRecord]
            | type[ReviewSchedule]
            | type[ErrorPattern]
            | type[AuditReview]
            | type[ReviewFinding]
            | type[Exam]
            | type[Subject]
            | type[SyllabusNode]
            | type[MockExam]
            | type[ScoreRecord]
            | type[LearningTrack]
            | type[StudyProject]
            | type[InboxItem]
            | type[Deliverable]
            | type[PaperRecord]
            | type[ResearchClaim]
            | type[ResearchQuestion]
            | type[ExperimentRun]
            | type[MetricRecord]
            | type[ResearchFeedback]
        ),
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        statement = (
            select(model)
            .join(Space, Space.id == model.space_id)
            .where(
                model.workspace_id == workspace_id,
                model.user_id == user_id,
                model.deleted_at.is_(None),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
            .order_by(model.id)
        )
        items = cast(
            list[
                MasteryRecord
                | ReviewSchedule
                | ErrorPattern
                | AuditReview
                | ReviewFinding
                | Exam
                | Subject
                | SyllabusNode
                | MockExam
                | ScoreRecord
                | LearningTrack
                | StudyProject
                | InboxItem
                | Deliverable
                | PaperRecord
                | ResearchClaim
                | ResearchQuestion
                | ExperimentRun
                | MetricRecord
                | ResearchFeedback
            ],
            list((await db.scalars(statement)).all()),
        )
        records: list[EntityRecord] = []
        for item in items:
            if isinstance(item, MasteryRecord):
                entity_type = "mastery"
                payload = mastery_payload(item)
            elif isinstance(item, ReviewSchedule):
                entity_type = "review_schedule"
                payload = review_schedule_payload(item)
            elif isinstance(item, ErrorPattern):
                entity_type = "error_pattern"
                payload = error_pattern_payload(item)
            elif isinstance(item, AuditReview):
                entity_type = "audit_review"
                payload = audit_review_payload(item)
            elif isinstance(item, ReviewFinding):
                entity_type = "review_finding"
                payload = review_finding_payload(item)
            elif isinstance(item, Exam):
                entity_type = "exam"
                payload = exam_payload(item)
            elif isinstance(item, Subject):
                entity_type = "exam_subject"
                payload = exam_subject_payload(item)
            elif isinstance(item, SyllabusNode):
                entity_type = "syllabus_node"
                payload = syllabus_node_payload(item)
            elif isinstance(item, MockExam):
                entity_type = "mock_exam"
                payload = mock_exam_payload(item)
            elif isinstance(item, ScoreRecord):
                entity_type = "score_record"
                payload = score_record_payload(item)
            elif isinstance(item, (LearningTrack, StudyProject, InboxItem, Deliverable)):
                entity_type = {
                    LearningTrack: "learning_track",
                    StudyProject: "study_project",
                    InboxItem: "inbox_item",
                    Deliverable: "deliverable",
                }[type(item)]
                payload = self_study_payload(item)
            else:
                entity_type = {
                    PaperRecord: "paper_record",
                    ResearchClaim: "research_claim",
                    ResearchQuestion: "research_question",
                    ExperimentRun: "experiment_run",
                    MetricRecord: "metric_record",
                    ResearchFeedback: "research_feedback",
                }[type(item)]
                payload = research_payload(item)
            records.append(
                EntityRecord(
                    entity_type=entity_type,
                    entity_id=item.id,
                    version=item.version,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                    deleted_at=item.deleted_at,
                    created_by=item.created_by or item.user_id,
                    updated_by=item.updated_by or item.user_id,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        return records

    async def _quiz_attempt_records(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        statement = (
            select(QuizAttempt)
            .join(Space, Space.id == QuizAttempt.space_id)
            .where(
                QuizAttempt.workspace_id == workspace_id,
                QuizAttempt.user_id == user_id,
                QuizAttempt.deleted_at.is_(None),
                (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            )
            .order_by(QuizAttempt.id)
        )
        attempts = list((await db.scalars(statement)).all())
        if not attempts:
            return []
        items = {
            item.id: item
            for item in (
                await db.scalars(
                    select(QuizItem).where(
                        QuizItem.id.in_([attempt.quiz_item_id for attempt in attempts])
                    )
                )
            ).all()
        }
        records: list[EntityRecord] = []
        for attempt in attempts:
            item = items.get(attempt.quiz_item_id)
            if item is None:
                continue
            payload = quiz_attempt_payload(attempt, item)
            records.append(
                EntityRecord(
                    entity_type="quiz_attempt",
                    entity_id=attempt.id,
                    version=attempt.version,
                    created_at=attempt.created_at,
                    updated_at=attempt.updated_at,
                    deleted_at=attempt.deleted_at,
                    created_by=attempt.created_by,
                    updated_by=attempt.updated_by,
                    payload=payload,
                    payload_hash=canonical_hash(payload),
                )
            )
        return records


class StaleSnapshotError(Exception):
    pass


class InvalidChunkError(Exception):
    pass
