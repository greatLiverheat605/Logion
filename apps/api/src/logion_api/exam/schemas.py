from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExamCreateRequest(StrictModel):
    id: UUID
    title: Title
    date_status: Literal["scheduled", "undetermined"]
    exam_at: datetime | None = None
    timezone: Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None = None
    target_score: int | None = Field(default=None, ge=0, le=1000000)
    score_scale_max: int | None = Field(default=None, ge=1, le=1000000)

    @model_validator(mode="after")
    def validate_date_and_score(self) -> "ExamCreateRequest":
        if self.date_status == "scheduled":
            if self.exam_at is None or self.exam_at.utcoffset() is None or self.timezone is None:
                raise ValueError("scheduled exams require a timezone-aware date and timezone")
            try:
                ZoneInfo(self.timezone)
            except ZoneInfoNotFoundError as exc:
                raise ValueError("timezone must be a recognized IANA zone") from exc
        elif self.exam_at is not None:
            raise ValueError("undetermined exams cannot include a date")
        if (self.target_score is None) != (self.score_scale_max is None):
            raise ValueError("target score and scale maximum must be provided together")
        if (
            self.target_score is not None
            and self.score_scale_max is not None
            and self.target_score > self.score_scale_max
        ):
            raise ValueError("target score cannot exceed scale maximum")
        return self


class ExamResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    title: str
    date_status: Literal["scheduled", "undetermined"]
    exam_at: datetime | None
    timezone: str | None
    target_score: int | None
    score_scale_max: int | None
    status: Literal["planning", "active", "completed", "archived"]
    version: int


class ExamListResponse(StrictModel):
    exams: list[ExamResponse]
