from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

MAX_WEEK_TASKS = 200
ReadingMode = Literal["close_read", "skim"]
Count = Annotated[int, Field(ge=0, strict=True)]


class WeeklyStrict(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class ReadingTaskFields(WeeklyStrict):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    goal_id: UUID
    resource_id: UUID | None = None
    reading_mode: ReadingMode = "close_read"
    scheduled_on: date
    estimated_minutes: int = Field(default=30, ge=0, le=1440)


class ReadingTaskView(ReadingTaskFields):
    id: UUID
    status: str
    version: int
    reading_completed_at: datetime | None


class ReadingTaskUpdate(ReadingTaskFields):
    expected_version: int = Field(ge=1)


class WeeklyVersion(WeeklyStrict):
    expected_version: int = Field(ge=1)


class ReadingTaskDecision(WeeklyVersion):
    status: Literal["planned", "done", "cancelled"]


class WeeklyStats(WeeklyStrict):
    planned: Count
    done: Count
    sources_close_read: Count
    sources_skimmed: Count
    quiz_attempts: Count
    quiz_graded: Count
    quiz_score_total: Count
    links_confirmed: Count
    links_suggested: Count
    links_rejected: Count
    open_questions: Count
    reviews_due: Count
    reviews_completed: Count
    inbox_items: Count = 0


class WeeklyReviewCreate(WeeklyStrict):
    week_start: date
    timezone: Annotated[str, StringConstraints(min_length=1, max_length=64)] = "UTC"

    @field_validator("week_start")
    @classmethod
    def monday(cls, value: date) -> date:
        if value.weekday() != 0 or not 1970 <= value.year <= 9998:
            raise ValueError("Choose a Monday")
        return value

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Choose an IANA time zone") from exc
        return value


class WeeklyTriage(WeeklyStrict):
    task_id: UUID
    action: Literal["carry", "downgrade", "drop"]
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""


class WeeklyTriageResult(WeeklyTriage):
    next_task_id: UUID | None = None


class WeeklyReviewClose(WeeklyVersion):
    triage: list[WeeklyTriage] = Field(max_length=MAX_WEEK_TASKS)


class WeeklyCommentAccept(WeeklyVersion):
    draft_id: UUID
    expected_draft_version: int = Field(ge=1)


class WeeklyReviewView(WeeklyStrict):
    id: UUID
    week_start: date
    timezone: str
    stats: WeeklyStats
    task_snapshot: list[ReadingTaskView]
    triage: list[WeeklyTriageResult]
    ai_comment: str | None
    ai_comment_run_id: UUID | None
    version: int
    closed_at: datetime | None


class WeeklyPlanView(WeeklyStrict):
    week_start: date
    tasks: list[ReadingTaskView]
    review: WeeklyReviewView | None
