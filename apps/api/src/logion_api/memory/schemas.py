from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MasteryLevel = Literal["unknown", "exposed", "practicing", "familiar", "proficient", "mastered"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TopicCreateRequest(StrictModel):
    id: UUID
    title: Title
    description: Description = ""


class TopicDependencyCreateRequest(StrictModel):
    id: UUID
    prerequisite_topic_id: UUID
    dependent_topic_id: UUID

    @model_validator(mode="after")
    def reject_self_dependency(self) -> "TopicDependencyCreateRequest":
        if self.prerequisite_topic_id == self.dependent_topic_id:
            raise ValueError("a topic cannot depend on itself")
        return self


class MasteryConfirmRequest(StrictModel):
    mastery_id: UUID
    schedule_id: UUID
    expected_version: int = Field(ge=0)
    confirmed_level: MasteryLevel

    @model_validator(mode="after")
    def distinct_identifiers(self) -> "MasteryConfirmRequest":
        if self.mastery_id == self.schedule_id:
            raise ValueError("mastery and schedule identifiers must differ")
        return self


class MasteryResponse(StrictModel):
    id: UUID
    topic_id: UUID
    suggested_level: MasteryLevel
    suggested_reason: str
    suggested_at: datetime | None
    confirmed_level: MasteryLevel | None
    confirmed_at: datetime | None
    version: int


class ReviewScheduleResponse(StrictModel):
    id: UUID
    topic_id: UUID
    status: Literal["scheduled", "due", "in_progress", "completed", "skipped"]
    source: Literal["mastery_confirmation", "manual", "quiz_error"]
    interval_days: int
    next_review_at: datetime
    last_reviewed_at: datetime | None
    version: int


class TopicResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    title: str
    description: str
    version: int
    mastery: MasteryResponse | None
    review_schedule: ReviewScheduleResponse | None


class TopicListResponse(StrictModel):
    topics: list[TopicResponse]


class TopicDependencyResponse(StrictModel):
    id: UUID
    prerequisite_topic_id: UUID
    dependent_topic_id: UUID
    version: int


class MasteryConfirmationResponse(StrictModel):
    mastery: MasteryResponse
    review_schedule: ReviewScheduleResponse


ErrorCause = Literal[
    "recall_gap",
    "concept_confusion",
    "misread",
    "careless",
    "application_gap",
    "unknown",
]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)]


class QuizItemCreateRequest(StrictModel):
    id: UUID
    topic_id: UUID
    prompt: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)]
    answer_key: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)
    ]
    explanation: LongText = ""
    evaluation_mode: Literal["exact_match", "self_assessed"]


class QuizItemResponse(StrictModel):
    id: UUID
    topic_id: UUID
    prompt: str
    evaluation_mode: Literal["exact_match", "self_assessed"]
    version: int


class QuizItemListResponse(StrictModel):
    quiz_items: list[QuizItemResponse]


class QuizAttemptCreateRequest(StrictModel):
    id: UUID
    error_pattern_id: UUID
    schedule_id: UUID
    response_text: LongText
    confidence: int = Field(ge=1, le=5)
    duration_seconds: int = Field(ge=0, le=86400)
    self_assessed_correct: bool | None = None
    error_cause: ErrorCause | None = None

    @model_validator(mode="after")
    def distinct_ids_and_cause_shape(self) -> "QuizAttemptCreateRequest":
        if len({self.id, self.error_pattern_id, self.schedule_id}) != 3:
            raise ValueError("attempt, error pattern, and schedule identifiers must differ")
        if self.self_assessed_correct is True and self.error_cause is not None:
            raise ValueError("a correct attempt cannot have an error cause")
        return self


class ErrorPatternResponse(StrictModel):
    id: UUID
    topic_id: UUID
    cause: ErrorCause
    occurrence_count: int
    status: Literal["open", "resolved"]
    latest_attempt_id: UUID
    version: int


class ErrorPatternListResponse(StrictModel):
    error_patterns: list[ErrorPatternResponse]


class ErrorPatternResolveRequest(StrictModel):
    expected_version: int = Field(ge=1)


class QuizAttemptResponse(StrictModel):
    id: UUID
    quiz_item_id: UUID
    topic_id: UUID
    response_text: str
    is_correct: bool
    confidence: int
    duration_seconds: int
    error_cause: ErrorCause | None
    attempted_at: datetime
    version: int
    answer_key: str
    explanation: str
    error_pattern: ErrorPatternResponse | None
    review_schedule: ReviewScheduleResponse | None


class QuizAttemptListResponse(StrictModel):
    attempts: list[QuizAttemptResponse]


class AuditReviewCreateRequest(StrictModel):
    id: UUID
    cadence: Literal["daily", "weekly"]
    period_start: date
    period_end: date
    summary: LongText = ""

    @model_validator(mode="after")
    def valid_period(self) -> "AuditReviewCreateRequest":
        days = (self.period_end - self.period_start).days
        maximum = 0 if self.cadence == "daily" else 6
        if days < 0 or days > maximum:
            raise ValueError("review period does not match cadence")
        return self


class AuditReviewCompleteRequest(StrictModel):
    expected_version: int = Field(ge=1)
    summary: LongText


class ReviewFindingCreateRequest(StrictModel):
    id: UUID
    category: Literal["progress", "blocker", "adjustment", "error_pattern"]
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10000)
    ]
    suggested_action: LongText = ""


class ReviewFindingResolveRequest(StrictModel):
    expected_version: int = Field(ge=1)


class ReviewFindingResponse(StrictModel):
    id: UUID
    audit_review_id: UUID
    category: Literal["progress", "blocker", "adjustment", "error_pattern"]
    description: str
    suggested_action: str
    status: Literal["open", "resolved"]
    version: int


class AuditReviewResponse(StrictModel):
    id: UUID
    cadence: Literal["daily", "weekly"]
    period_start: date
    period_end: date
    status: Literal["draft", "completed"]
    summary: str
    completed_at: datetime | None
    version: int
    findings: list[ReviewFindingResponse]


class AuditReviewListResponse(StrictModel):
    reviews: list[AuditReviewResponse]
