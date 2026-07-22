from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MasteryLevel = Literal[
    "unknown", "exposed", "practicing", "familiar", "proficient", "mastered"
]
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
    source: Literal["mastery_confirmation", "manual"]
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
