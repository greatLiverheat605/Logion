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


class SubjectCreateRequest(StrictModel):
    id: UUID
    exam_id: UUID
    name: Title
    weight_basis_points: int = Field(default=0, ge=0, le=10000)


class SubjectResponse(StrictModel):
    id: UUID
    exam_id: UUID
    name: str
    weight_basis_points: int
    status: Literal["active", "archived"]
    version: int


class SubjectListResponse(StrictModel):
    subjects: list[SubjectResponse]


class SyllabusNodeCreateRequest(StrictModel):
    id: UUID
    subject_id: UUID
    parent_id: UUID | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
    importance: int = Field(default=3, ge=1, le=5)

    @model_validator(mode="after")
    def reject_self_parent(self) -> "SyllabusNodeCreateRequest":
        if self.parent_id == self.id:
            raise ValueError("a syllabus node cannot be its own parent")
        return self


class SyllabusNodeResponse(StrictModel):
    id: UUID
    subject_id: UUID
    parent_id: UUID | None
    title: str
    importance: int
    coverage_status: Literal["not_started", "in_progress", "covered"]
    version: int


class SyllabusNodeListResponse(StrictModel):
    nodes: list[SyllabusNodeResponse]


class MockExamCreateRequest(StrictModel):
    id: UUID
    exam_id: UUID
    title: Title
    duration_limit_seconds: int = Field(ge=60, le=86400)


class MockExamResponse(StrictModel):
    id: UUID
    exam_id: UUID
    title: str
    duration_limit_seconds: int
    version: int


class MockExamListResponse(StrictModel):
    mock_exams: list[MockExamResponse]


class ScoreRecordCreateRequest(StrictModel):
    id: UUID
    mock_exam_id: UUID
    score: int = Field(ge=0, le=1000000)
    score_scale_max: int = Field(ge=1, le=1000000)
    duration_seconds: int = Field(ge=0, le=86400)
    completed_at: datetime

    @model_validator(mode="after")
    def valid_score_and_time(self) -> "ScoreRecordCreateRequest":
        if self.score > self.score_scale_max:
            raise ValueError("score cannot exceed scale maximum")
        if self.completed_at.utcoffset() is None:
            raise ValueError("completion time must include a timezone")
        return self


class ScoreRecordResponse(StrictModel):
    id: UUID
    mock_exam_id: UUID
    score: int
    score_scale_max: int
    duration_seconds: int
    completed_at: datetime
    version: int


class ScoreRecordListResponse(StrictModel):
    score_records: list[ScoreRecordResponse]
