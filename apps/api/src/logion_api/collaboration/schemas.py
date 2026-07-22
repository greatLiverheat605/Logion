from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30000)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=30000)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CollaborationRubricCreate(Strict):
    id: UUID
    title: Short
    criteria: Long


class CollaborationReviewCreate(Strict):
    id: UUID
    rubric_id: UUID
    subject_title: Short
    submission_summary: Long


class CollaborationFeedbackCreate(Strict):
    id: UUID
    review_id: UUID
    feedback: Long
    recommended_action: OptionalText = ""


class CollaborationReportCreate(Strict):
    id: UUID
    review_id: UUID
    summary: Long
    published_at: datetime

    @model_validator(mode="after")
    def aware(self) -> "CollaborationReportCreate":
        if self.published_at.utcoffset() is None:
            raise ValueError("publication time must include timezone")
        return self


class CollaborationRubricResponse(CollaborationRubricCreate):
    workspace_id: UUID
    space_id: UUID
    version: int


class CollaborationReviewResponse(CollaborationReviewCreate):
    version: int


class CollaborationFeedbackResponse(CollaborationFeedbackCreate):
    version: int


class CollaborationReportResponse(CollaborationReportCreate):
    version: int


class CollaborationList(Strict):
    rubrics: list[CollaborationRubricResponse]
    reviews: list[CollaborationReviewResponse]
    feedback: list[CollaborationFeedbackResponse]
    reports: list[CollaborationReportResponse]
