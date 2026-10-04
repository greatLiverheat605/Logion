"""Owner-scoped reading plans; one Space lock serializes review/rollover writes."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import Integer, Select, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.agents.models import AgentInboxItem
from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.models import Task
from logion_api.identity.service import AuthContext
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.library.service import LibraryService, not_found
from logion_api.memory.models import QuizAttempt, QuizItem, ReviewSchedule, Topic
from logion_api.planning.models import LearningGoal, WeeklyReview
from logion_api.planning.weekly_schemas import (
    MAX_WEEK_TASKS,
    ReadingTaskDecision,
    ReadingTaskFields,
    ReadingTaskView,
    WeeklyReviewClose,
    WeeklyReviewCreate,
    WeeklyStats,
)
from logion_api.research.models import ResearchQuestion
from logion_api.workspaces.models import Space


def week_of(day: date) -> date:
    if not 1970 <= day.year <= 9998:
        raise APIError(
            code="VALIDATION_ERROR", message="Choose a date from 1970 to 9998.", status_code=422
        )
    return day - timedelta(days=day.weekday())


def conflict(code: str = "RESOURCE_VERSION_CONFLICT") -> APIError:
    return APIError(code=code, message="Reload the weekly plan and review.", status_code=409)


def snapshot(tasks: list[Task]) -> list[dict[str, Any]]:
    return [ReadingTaskView.model_validate(task).model_dump(mode="json") for task in tasks]


class WeeklyService:
    def __init__(
        self,
        db: AsyncSession,
        library: LibraryService,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> None:
        self.db, self.library, self.context = db, library, context
        self.workspace_id, self.space_id, self.request_id = workspace_id, space_id, request_id
        self.user_id = context.user.id

    async def authorize(self, *, write: bool = False) -> None:
        await self.library.authorize(
            self.db, self.context, self.workspace_id, self.space_id, self.request_id, write=write
        )
        if write:
            # ponytail: Space serialization is adequate for the <=10-person deployment.
            await self.db.scalar(select(Space).where(Space.id == self.space_id).with_for_update())

    def scope(self, model: Any, owner: str = "user_id") -> Any:
        return select(model).where(
            model.workspace_id == self.workspace_id,
            model.space_id == self.space_id,
            getattr(model, owner) == self.user_id,
            model.deleted_at.is_(None),
        )

    async def tasks(self, week: date) -> list[Task]:
        return list(
            await self.db.scalars(
                self.scope(Task, "research_owner_id")
                .where(Task.scheduled_on >= week, Task.scheduled_on < week + timedelta(days=7))
                .order_by(Task.scheduled_on, Task.id)
                .limit(MAX_WEEK_TASKS)
            )
        )

    async def review(self, week: date) -> WeeklyReview | None:
        row: WeeklyReview | None = await self.db.scalar(
            self.scope(WeeklyReview).where(WeeklyReview.week_start == week)
        )
        return row

    async def get_review(self, identifier: UUID, version: int | None = None) -> WeeklyReview:
        row: WeeklyReview | None = await self.db.scalar(
            self.scope(WeeklyReview).where(WeeklyReview.id == identifier)
        )
        if row is None:
            raise not_found()
        if version is not None and row.version != version:
            raise conflict()
        return row

    async def open_week(self, day: date, *, extra: int = 0) -> None:
        week = week_of(day)
        review = await self.review(week)
        if review is not None and review.closed_at is not None:
            raise conflict("WEEKLY_REVIEW_CLOSED")
        if extra:
            size = await self.db.scalar(
                self.scope(Task, "research_owner_id")
                .where(Task.scheduled_on >= week, Task.scheduled_on < week + timedelta(days=7))
                .with_only_columns(func.count())
                .order_by(None)
            )
            if int(size or 0) + extra > MAX_WEEK_TASKS:
                raise conflict("WEEKLY_TASK_LIMIT")

    async def references(self, goal_id: UUID, resource_id: UUID | None) -> Resource | None:
        goal = await self.db.scalar(
            select(LearningGoal)
            .where(
                LearningGoal.id == goal_id,
                LearningGoal.workspace_id == self.workspace_id,
                LearningGoal.space_id == self.space_id,
                LearningGoal.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if goal is None:
            raise not_found()
        if resource_id is None:
            return None
        resource = await self.library.get(
            self.db,
            self.context,
            self.workspace_id,
            self.space_id,
            resource_id,
            self.request_id,
            write=True,
        )
        if resource.reading_status == "archived":
            raise conflict("READING_TRANSITION_INVALID")
        return resource

    async def new_task(self, payload: ReadingTaskFields) -> Task:
        await self.open_week(payload.scheduled_on, extra=1)
        await self.references(payload.goal_id, payload.resource_id)
        task = Task(
            **payload.model_dump(),
            workspace_id=self.workspace_id,
            space_id=self.space_id,
            research_owner_id=self.user_id,
            status="planned",
            created_by=self.user_id,
            updated_by=self.user_id,
        )
        self.db.add(task)
        await self.db.flush()
        return task

    async def get_task(self, identifier: UUID, version: int) -> Task:
        task: Task | None = await self.db.scalar(
            self.scope(Task, "research_owner_id").where(Task.id == identifier)
        )
        if task is None:
            raise not_found()
        if task.version != version:
            raise conflict()
        assert task.scheduled_on is not None
        await self.open_week(task.scheduled_on)
        return task

    def touch(self, row: Task | WeeklyReview) -> None:
        row.version += 1
        row.updated_at = utc_now()
        if isinstance(row, Task):
            row.updated_by = self.user_id

    async def decide(self, task: Task, payload: ReadingTaskDecision) -> None:
        if task.status == payload.status:
            return
        if payload.status == "done":
            resource = await self.references(task.goal_id, task.resource_id)
            if resource is not None:
                if task.reading_mode == "close_read" and resource.reading_status != "close_read":
                    raise conflict("READING_CLOSE_READ_REQUIRED")
                if task.reading_mode == "skim" and resource.reading_status != "close_read":
                    resource.reading_status, resource.read_at = "skimmed", utc_now()
                    resource.updated_at, resource.updated_by = utc_now(), self.user_id
                    resource.version += 1
            task.reading_completed_at = utc_now()
        else:
            task.reading_completed_at = None
        task.status = payload.status
        self.touch(task)

    async def count(self, query: Select[Any]) -> int:
        return int(await self.db.scalar(query.with_only_columns(func.count()).order_by(None)) or 0)

    async def statistics(self, week: date, timezone: str, tasks: list[Task]) -> dict[str, int]:
        start = datetime.combine(week, time.min, ZoneInfo(timezone)).astimezone(UTC)
        end = datetime.combine(week + timedelta(days=7), time.min, ZoneInfo(timezone)).astimezone(
            UTC
        )
        sources = self.scope(Resource, "research_owner_id").where(
            Resource.read_at >= start, Resource.read_at < end
        )
        attempts = (
            self.scope(QuizAttempt)
            .join(QuizItem, QuizItem.id == QuizAttempt.quiz_item_id)
            .where(
                QuizAttempt.attempted_at >= start,
                QuizAttempt.attempted_at < end,
                QuizItem.deleted_at.is_(None),
                QuizItem.research_owner_id == self.user_id,
            )
        )
        links = select(KnowledgeEdge).where(
            KnowledgeEdge.workspace_id == self.workspace_id,
            KnowledgeEdge.space_id == self.space_id,
            KnowledgeEdge.user_id == self.user_id,
            KnowledgeEdge.from_type != "idea",
            KnowledgeEdge.to_type != "idea",
            KnowledgeEdge.updated_at >= start,
            KnowledgeEdge.updated_at < end,
        )
        reviews = (
            self.scope(ReviewSchedule)
            .join(Topic, Topic.id == ReviewSchedule.topic_id)
            .where(
                Topic.deleted_at.is_(None),
                Topic.research_owner_id.is_(None) | (Topic.research_owner_id == self.user_id),
            )
        )
        inbox = select(AgentInboxItem).where(
            AgentInboxItem.workspace_id == self.workspace_id,
            AgentInboxItem.space_id == self.space_id,
            AgentInboxItem.user_id == self.user_id,
            AgentInboxItem.created_at >= start,
            AgentInboxItem.created_at < end,
        )
        stats = WeeklyStats(
            inbox_items=await self.count(inbox),
            planned=len(tasks),
            done=sum(task.status == "done" for task in tasks),
            sources_close_read=await self.count(
                sources.where(Resource.reading_status == "close_read")
            ),
            sources_skimmed=await self.count(sources.where(Resource.reading_status == "skimmed")),
            quiz_attempts=await self.count(attempts),
            quiz_graded=await self.count(attempts.where(QuizAttempt.ai_grade.is_not(None))),
            quiz_score_total=int(
                await self.db.scalar(
                    attempts.with_only_columns(
                        func.sum(cast(QuizAttempt.ai_grade["score"].astext, Integer))
                    )
                )
                or 0
            ),
            links_confirmed=await self.count(links.where(KnowledgeEdge.status == "confirmed")),
            links_suggested=await self.count(links.where(KnowledgeEdge.status == "suggested")),
            links_rejected=await self.count(links.where(KnowledgeEdge.status == "rejected")),
            open_questions=await self.count(
                self.scope(ResearchQuestion).where(ResearchQuestion.status == "active")
            ),
            reviews_due=await self.count(
                reviews.where(
                    ReviewSchedule.status.in_(["scheduled", "due", "in_progress"]),
                    ReviewSchedule.next_review_at < end,
                )
            ),
            reviews_completed=await self.count(
                reviews.where(
                    ReviewSchedule.last_reviewed_at >= start,
                    ReviewSchedule.last_reviewed_at < end,
                )
            ),
        )
        return stats.model_dump()

    async def capture(self, row: WeeklyReview) -> None:
        if row.closed_at is not None:
            raise conflict("WEEKLY_REVIEW_CLOSED")
        tasks = await self.tasks(row.week_start)
        row.stats = await self.statistics(row.week_start, row.timezone, tasks)
        row.task_snapshot, row.triage = snapshot(tasks), []
        row.ai_comment, row.ai_comment_run_id = None, None

    async def create_review(self, payload: WeeklyReviewCreate) -> WeeklyReview:
        row = await self.review(payload.week_start)
        if row is None:
            row = WeeklyReview(
                workspace_id=self.workspace_id,
                space_id=self.space_id,
                user_id=self.user_id,
                week_start=payload.week_start,
                timezone=payload.timezone,
            )
            await self.capture(row)
            self.db.add(row)
            await self.db.flush()
        return row

    async def close(self, row: WeeklyReview, payload: WeeklyReviewClose) -> None:
        if row.closed_at is not None:
            return
        if row.version != payload.expected_version:
            raise conflict()
        tasks = await self.tasks(row.week_start)
        if snapshot(tasks) != row.task_snapshot:
            raise conflict("WEEKLY_SNAPSHOT_STALE")
        unfinished = {task.id: task for task in tasks if task.status != "done"}
        if len(payload.triage) != len(unfinished) or {
            item.task_id for item in payload.triage
        } != set(unfinished):
            raise conflict("WEEKLY_TRIAGE_REQUIRED")
        results = []
        for decision in payload.triage:
            original = unfinished[decision.task_id]
            next_task = None
            if decision.action != "drop":
                if decision.action == "downgrade" and original.reading_mode != "close_read":
                    raise conflict("WEEKLY_DOWNGRADE_INVALID")
                fields = ReadingTaskFields.model_validate(original)
                fields.scheduled_on += timedelta(days=7)
                if decision.action == "downgrade":
                    fields.reading_mode = "skim"
                next_task = await self.new_task(fields)
            results.append(
                {
                    **decision.model_dump(mode="json"),
                    "next_task_id": str(next_task.id) if next_task else None,
                }
            )
        row.triage, row.closed_at = results, utc_now()
        self.touch(row)

    def audit(self, action: str) -> None:
        self.library.audit(self.db, self.context, self.request_id, f"weekly_{action}")
