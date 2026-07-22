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
from logion_api.memory.schemas import (
    AuditReviewCompleteRequest,
    AuditReviewCreateRequest,
    ErrorPatternResolveRequest,
    MasteryConfirmRequest,
    MasteryLevel,
    QuizAttemptCreateRequest,
    QuizItemCreateRequest,
    ReviewFindingCreateRequest,
    ReviewFindingResolveRequest,
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
READ_PAGE_LIMIT = 500
REVIEW_PAGE_LIMIT = 100
FINDING_PAGE_LIMIT = 1000


def _normalized_answer(value: str) -> str:
    return " ".join(value.casefold().split())


@dataclass(frozen=True)
class TopicView:
    topic: Topic
    mastery: MasteryRecord | None
    review_schedule: ReviewSchedule | None


@dataclass(frozen=True)
class MasteryConfirmation:
    mastery: MasteryRecord
    review_schedule: ReviewSchedule


@dataclass(frozen=True)
class QuizAttemptResult:
    attempt: QuizAttempt
    item: QuizItem
    error_pattern: ErrorPattern | None
    review_schedule: ReviewSchedule | None


@dataclass(frozen=True)
class AuditReviewView:
    review: AuditReview
    findings: list[ReviewFinding]


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
                        Topic.id.in_([payload.prerequisite_topic_id, payload.dependent_topic_id]),
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

    async def create_quiz_item(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: QuizItemCreateRequest,
        request_id: str,
    ) -> QuizItem:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=True
        )
        topic = await db.scalar(
            select(Topic).where(
                Topic.id == payload.topic_id,
                Topic.workspace_id == workspace_id,
                Topic.space_id == space_id,
                Topic.deleted_at.is_(None),
            )
        )
        if topic is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        item_count = int(
            await db.scalar(
                select(func.count(QuizItem.id)).where(
                    QuizItem.workspace_id == workspace_id,
                    QuizItem.space_id == space_id,
                    QuizItem.deleted_at.is_(None),
                )
            )
            or 0
        )
        if item_count >= self._settings.quiz_item_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The Space has reached its quiz-item limit.",
                status_code=409,
            )
        if await db.get(QuizItem, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        item = QuizItem(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            topic_id=payload.topic_id,
            prompt=payload.prompt,
            answer_key=payload.answer_key,
            explanation=payload.explanation,
            evaluation_mode=payload.evaluation_mode,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(item)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.quiz_item_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="quiz_item",
                target_id=item.id,
                metadata={"topic_id": str(item.topic_id)},
            )
        )
        return item

    async def list_quiz_items(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[QuizItem]:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        return list(
            (
                await db.scalars(
                    select(QuizItem)
                    .where(
                        QuizItem.workspace_id == workspace_id,
                        QuizItem.space_id == space_id,
                        QuizItem.deleted_at.is_(None),
                    )
                    .order_by(QuizItem.updated_at.desc(), QuizItem.id)
                    .limit(READ_PAGE_LIMIT)
                )
            ).all()
        )

    async def submit_quiz_attempt(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        quiz_item_id: UUID,
        payload: QuizAttemptCreateRequest,
        request_id: str,
    ) -> QuizAttemptResult:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        item = await db.scalar(
            select(QuizItem)
            .where(
                QuizItem.id == quiz_item_id,
                QuizItem.workspace_id == workspace_id,
                QuizItem.space_id == space_id,
                QuizItem.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if item is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
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
        if await db.get(QuizAttempt, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        attempt_count = int(
            await db.scalar(
                select(func.count(QuizAttempt.id)).where(
                    QuizAttempt.workspace_id == workspace_id,
                    QuizAttempt.user_id == context.user.id,
                    QuizAttempt.deleted_at.is_(None),
                )
            )
            or 0
        )
        if attempt_count >= self._settings.quiz_attempt_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its quiz-attempt limit.",
                status_code=409,
            )
        if item.evaluation_mode == "exact_match":
            if payload.self_assessed_correct is not None:
                raise APIError(
                    code="RESOURCE_INPUT_INVALID",
                    message="Exact-match items are evaluated by the server.",
                    status_code=422,
                )
            is_correct = _normalized_answer(payload.response_text) == _normalized_answer(
                item.answer_key
            )
        else:
            if payload.self_assessed_correct is None:
                raise APIError(
                    code="RESOURCE_INPUT_INVALID",
                    message="A self-assessed result is required.",
                    status_code=422,
                )
            is_correct = payload.self_assessed_correct
        if is_correct and payload.error_cause is not None and item.evaluation_mode != "exact_match":
            raise APIError(
                code="RESOURCE_INPUT_INVALID",
                message="A correct attempt cannot have an error cause.",
                status_code=422,
            )
        if not is_correct and payload.error_cause is None:
            raise APIError(
                code="RESOURCE_INPUT_INVALID",
                message="An incorrect attempt requires an error cause.",
                status_code=422,
            )
        now = utc_now()
        attempt = QuizAttempt(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            topic_id=item.topic_id,
            quiz_item_id=item.id,
            user_id=context.user.id,
            response_text=payload.response_text,
            is_correct=is_correct,
            confidence=payload.confidence,
            duration_seconds=payload.duration_seconds,
            error_cause=None if is_correct else payload.error_cause,
            attempted_at=now,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(attempt)
        await db.flush()
        pattern: ErrorPattern | None = None
        schedule: ReviewSchedule | None = None
        if not is_correct:
            assert payload.error_cause is not None
            pattern = await db.scalar(
                select(ErrorPattern)
                .where(
                    ErrorPattern.workspace_id == workspace_id,
                    ErrorPattern.topic_id == item.topic_id,
                    ErrorPattern.user_id == context.user.id,
                    ErrorPattern.cause == payload.error_cause,
                    ErrorPattern.deleted_at.is_(None),
                )
                .with_for_update()
            )
            if pattern is None:
                if await db.get(ErrorPattern, payload.error_pattern_id) is not None:
                    raise APIError(
                        code="RESOURCE_VERSION_CONFLICT",
                        message="The error pattern changed.",
                        status_code=409,
                    )
                pattern = ErrorPattern(
                    id=payload.error_pattern_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    topic_id=item.topic_id,
                    user_id=context.user.id,
                    cause=payload.error_cause,
                    latest_attempt_id=attempt.id,
                    created_by=context.user.id,
                    updated_by=context.user.id,
                )
                db.add(pattern)
            elif pattern.id != payload.error_pattern_id:
                raise APIError(
                    code="RESOURCE_VERSION_CONFLICT",
                    message="The error pattern changed.",
                    status_code=409,
                )
            else:
                pattern.occurrence_count += 1
                pattern.latest_attempt_id = attempt.id
                pattern.status = "open"
                pattern.version += 1
                pattern.updated_by = context.user.id
                pattern.updated_at = now
            schedule = await db.scalar(
                select(ReviewSchedule)
                .where(
                    ReviewSchedule.workspace_id == workspace_id,
                    ReviewSchedule.topic_id == item.topic_id,
                    ReviewSchedule.user_id == context.user.id,
                    ReviewSchedule.deleted_at.is_(None),
                )
                .with_for_update()
            )
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
                    topic_id=item.topic_id,
                    user_id=context.user.id,
                    status="due",
                    source="quiz_error",
                    interval_days=1,
                    next_review_at=now,
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
                schedule.status = "due"
                schedule.source = "quiz_error"
                schedule.interval_days = 1
                schedule.next_review_at = now
                schedule.version += 1
                schedule.updated_by = context.user.id
                schedule.updated_at = now
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.quiz_attempt_recorded",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="quiz_attempt",
                target_id=attempt.id,
                metadata={"quiz_item_id": str(item.id), "topic_id": str(item.topic_id)},
            )
        )
        return QuizAttemptResult(attempt, item, pattern, schedule)

    async def list_quiz_attempts(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[QuizAttemptResult]:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        attempts = list(
            (
                await db.scalars(
                    select(QuizAttempt)
                    .where(
                        QuizAttempt.workspace_id == workspace_id,
                        QuizAttempt.space_id == space_id,
                        QuizAttempt.user_id == context.user.id,
                        QuizAttempt.deleted_at.is_(None),
                    )
                    .order_by(QuizAttempt.attempted_at.desc(), QuizAttempt.id)
                    .limit(READ_PAGE_LIMIT)
                )
            ).all()
        )
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
        return [
            QuizAttemptResult(attempt, items[attempt.quiz_item_id], None, None)
            for attempt in attempts
        ]

    async def list_error_patterns(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[ErrorPattern]:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        return list(
            (
                await db.scalars(
                    select(ErrorPattern)
                    .where(
                        ErrorPattern.workspace_id == workspace_id,
                        ErrorPattern.space_id == space_id,
                        ErrorPattern.user_id == context.user.id,
                        ErrorPattern.deleted_at.is_(None),
                    )
                    .order_by(ErrorPattern.updated_at.desc(), ErrorPattern.id)
                    .limit(READ_PAGE_LIMIT)
                )
            ).all()
        )

    async def resolve_error_pattern(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        pattern_id: UUID,
        payload: ErrorPatternResolveRequest,
        request_id: str,
    ) -> ErrorPattern:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        pattern = await db.scalar(
            select(ErrorPattern)
            .where(
                ErrorPattern.id == pattern_id,
                ErrorPattern.workspace_id == workspace_id,
                ErrorPattern.space_id == space_id,
                ErrorPattern.user_id == context.user.id,
                ErrorPattern.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if pattern is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if pattern.status != "open" or pattern.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The error pattern changed.",
                status_code=409,
            )
        pattern.status = "resolved"
        pattern.version += 1
        pattern.updated_by = context.user.id
        pattern.updated_at = utc_now()
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.error_pattern_resolved",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="error_pattern",
                target_id=pattern.id,
            )
        )
        return pattern

    async def create_audit_review(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: AuditReviewCreateRequest,
        request_id: str,
    ) -> AuditReviewView:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
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
        if await db.get(AuditReview, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        review_count = int(
            await db.scalar(
                select(func.count(AuditReview.id)).where(
                    AuditReview.workspace_id == workspace_id,
                    AuditReview.user_id == context.user.id,
                    AuditReview.deleted_at.is_(None),
                )
            )
            or 0
        )
        if review_count >= self._settings.audit_review_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The account has reached its audit-review limit.",
                status_code=409,
            )
        existing_period = await db.scalar(
            select(AuditReview.id).where(
                AuditReview.workspace_id == workspace_id,
                AuditReview.space_id == space_id,
                AuditReview.user_id == context.user.id,
                AuditReview.cadence == payload.cadence,
                AuditReview.period_start == payload.period_start,
                AuditReview.period_end == payload.period_end,
                AuditReview.deleted_at.is_(None),
            )
        )
        if existing_period is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="A review already exists for this period.",
                status_code=409,
            )
        review = AuditReview(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            cadence=payload.cadence,
            period_start=payload.period_start,
            period_end=payload.period_end,
            summary=payload.summary,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(review)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.audit_review_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="audit_review",
                target_id=review.id,
                metadata={"cadence": review.cadence},
            )
        )
        return AuditReviewView(review, [])

    async def list_audit_reviews(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[AuditReviewView]:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        reviews = list(
            (
                await db.scalars(
                    select(AuditReview)
                    .where(
                        AuditReview.workspace_id == workspace_id,
                        AuditReview.space_id == space_id,
                        AuditReview.user_id == context.user.id,
                        AuditReview.deleted_at.is_(None),
                    )
                    .order_by(AuditReview.period_end.desc(), AuditReview.id)
                    .limit(REVIEW_PAGE_LIMIT)
                )
            ).all()
        )
        findings = (
            list(
                (
                    await db.scalars(
                        select(ReviewFinding)
                        .where(
                            ReviewFinding.workspace_id == workspace_id,
                            ReviewFinding.user_id == context.user.id,
                            ReviewFinding.audit_review_id.in_([item.id for item in reviews]),
                            ReviewFinding.deleted_at.is_(None),
                        )
                        .limit(FINDING_PAGE_LIMIT)
                    )
                ).all()
            )
            if reviews
            else []
        )
        by_review: dict[UUID, list[ReviewFinding]] = {}
        for finding in findings:
            by_review.setdefault(finding.audit_review_id, []).append(finding)
        return [AuditReviewView(review, by_review.get(review.id, [])) for review in reviews]

    async def add_review_finding(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        review_id: UUID,
        payload: ReviewFindingCreateRequest,
        request_id: str,
    ) -> ReviewFinding:
        review = await self._owned_review(
            db, context, workspace_id, space_id, review_id, request_id, lock=True
        )
        if review.status != "draft":
            raise APIError(
                code="RESOURCE_STATE_CONFLICT",
                message="Completed reviews cannot be edited.",
                status_code=409,
            )
        if await db.get(ReviewFinding, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        finding = ReviewFinding(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            audit_review_id=review.id,
            user_id=context.user.id,
            category=payload.category,
            description=payload.description,
            suggested_action=payload.suggested_action,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(finding)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.review_finding_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="review_finding",
                target_id=finding.id,
                metadata={"audit_review_id": str(review.id)},
            )
        )
        return finding

    async def complete_audit_review(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        review_id: UUID,
        payload: AuditReviewCompleteRequest,
        request_id: str,
    ) -> AuditReviewView:
        review = await self._owned_review(
            db, context, workspace_id, space_id, review_id, request_id, lock=True
        )
        if review.status != "draft" or review.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The audit review changed.",
                status_code=409,
            )
        now = utc_now()
        review.status = "completed"
        review.summary = payload.summary
        review.completed_by = context.user.id
        review.completed_at = now
        review.version += 1
        review.updated_by = context.user.id
        review.updated_at = now
        findings = list(
            (
                await db.scalars(
                    select(ReviewFinding)
                    .where(
                        ReviewFinding.audit_review_id == review.id,
                        ReviewFinding.user_id == context.user.id,
                        ReviewFinding.deleted_at.is_(None),
                    )
                    .limit(FINDING_PAGE_LIMIT)
                )
            ).all()
        )
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.audit_review_completed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="audit_review",
                target_id=review.id,
            )
        )
        return AuditReviewView(review, findings)

    async def resolve_review_finding(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        review_id: UUID,
        finding_id: UUID,
        payload: ReviewFindingResolveRequest,
        request_id: str,
    ) -> ReviewFinding:
        await self._owned_review(
            db, context, workspace_id, space_id, review_id, request_id, lock=False
        )
        finding = await db.scalar(
            select(ReviewFinding)
            .where(
                ReviewFinding.id == finding_id,
                ReviewFinding.workspace_id == workspace_id,
                ReviewFinding.space_id == space_id,
                ReviewFinding.audit_review_id == review_id,
                ReviewFinding.user_id == context.user.id,
                ReviewFinding.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if finding is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if finding.status != "open" or finding.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The review finding changed.",
                status_code=409,
            )
        finding.status = "resolved"
        finding.version += 1
        finding.updated_by = context.user.id
        finding.updated_at = utc_now()
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="memory.review_finding_resolved",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="review_finding",
                target_id=finding.id,
            )
        )
        return finding

    async def _owned_review(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        review_id: UUID,
        request_id: str,
        *,
        lock: bool,
    ) -> AuditReview:
        await self._resolve_space(
            db, context, workspace_id, space_id, request_id, shared_write=False
        )
        statement = select(AuditReview).where(
            AuditReview.id == review_id,
            AuditReview.workspace_id == workspace_id,
            AuditReview.space_id == space_id,
            AuditReview.user_id == context.user.id,
            AuditReview.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update()
        review = await db.scalar(statement)
        if review is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        return review

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
            if (
                payload.expected_version != 0
                or (await db.get(MasteryRecord, payload.mastery_id)) is not None
            ):
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
            if expected_version != 0 or (await db.get(MasteryRecord, mastery_id)) is not None:
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
