from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints, model_validator

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Long = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30000)]
OptionalText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=30000)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PaperCreate(Strict):
    id: UUID
    title: Short
    citation_key: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)
    ]
    source_url: HttpUrl | None = None


class ClaimCreate(Strict):
    id: UUID
    paper_id: UUID
    statement: Long
    stance: Literal["supports", "opposes", "mixed", "unknown"]


class QuestionCreate(Strict):
    id: UUID
    question: Long
    rationale: OptionalText = ""


class RunCreate(Strict):
    id: UUID
    question_id: UUID
    title: Short
    method_summary: Long
    completed_at: datetime

    @model_validator(mode="after")
    def aware(self) -> "RunCreate":
        if self.completed_at.utcoffset() is None:
            raise ValueError("completion time must include a timezone")
        return self


class MetricCreate(Strict):
    id: UUID
    run_id: UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    value: float = Field(ge=-1e300, le=1e300)
    unit: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""


class FeedbackCreate(Strict):
    id: UUID
    claim_id: UUID
    description: Long
    requested_action: OptionalText = ""


class PaperResponse(PaperCreate):
    workspace_id: UUID
    space_id: UUID
    version: int


class ClaimResponse(ClaimCreate):
    version: int


class QuestionResponse(QuestionCreate):
    version: int


class RunResponse(RunCreate):
    version: int


class MetricResponse(MetricCreate):
    version: int


class FeedbackResponse(FeedbackCreate):
    version: int


class ResearchList(Strict):
    papers: list[PaperResponse]
    claims: list[ClaimResponse]
    questions: list[QuestionResponse]
    runs: list[RunResponse]
    metrics: list[MetricResponse]
    feedback: list[FeedbackResponse]
