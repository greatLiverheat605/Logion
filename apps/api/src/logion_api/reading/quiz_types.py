"""Bounded structured quiz output; provider text is always untrusted."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter, ValidationError

from logion_api.errors import APIError
from logion_api.memory.schemas import MasteryResponse, ReviewScheduleResponse

QuizText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=8000, pattern=r"^[^\x00]+$"),
]
ConceptText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=160, pattern=r"^[^\x00]+$"),
]


class QuizQuestionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    prompt: QuizText
    answer_key: QuizText
    explanation: QuizText
    concept: ConceptText


class QuizGrade(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    score: int = Field(ge=0, le=100)
    reasoning: QuizText
    weak_concepts: list[ConceptText] = Field(max_length=20)


class ReadingGrade(QuizGrade):
    ai_run_id: UUID
    graded_at: datetime


def parse_questions(output: dict[str, str]) -> list[QuizQuestionDraft]:
    try:
        if set(output) != {"questions"}:
            raise ValueError("Unexpected output fields")
        return TypeAdapter(
            Annotated[list[QuizQuestionDraft], Field(min_length=5, max_length=5)]
        ).validate_json(output["questions"])
    except (ValidationError, ValueError) as exc:
        raise APIError(
            code="AI_DRAFT_SCHEMA_INVALID",
            message="Expected five valid quiz questions.",
            status_code=422,
        ) from exc


def parse_grade(output: dict[str, str]) -> QuizGrade:
    try:
        if set(output) != {"grade"}:
            raise ValueError("Unexpected output fields")
        return QuizGrade.model_validate_json(output["grade"])
    except (ValidationError, ValueError) as exc:
        raise APIError(
            code="AI_DRAFT_SCHEMA_INVALID",
            message="Expected bounded grading evidence.",
            status_code=422,
        ) from exc


class ReadingAttempt(BaseModel):
    id: UUID
    quiz_item_id: UUID
    response_text: str
    attempted_at: datetime
    version: int
    ai_grade: ReadingGrade | None


class ReadingQuizItem(BaseModel):
    id: UUID
    resource_id: UUID
    topic_id: UUID
    concept: str
    prompt: str
    origin: Literal["user", "ai"]
    ai_run_id: UUID | None
    version: int
    latest_attempt: ReadingAttempt | None
    mastery: MasteryResponse | None
    review_schedule: ReviewScheduleResponse | None


class ReadingQuiz(BaseModel):
    items: list[ReadingQuizItem]


class ReadingQuizDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["accepted", "rejected"]
    expected_resource_version: int = Field(ge=1)
    expected_draft_version: int = Field(ge=1)


class ReadingAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    expected_item_version: int = Field(ge=1)
    response_text: QuizText
    confidence: int = Field(default=3, ge=1, le=5)
    duration_seconds: int = Field(default=0, ge=0, le=86400)


class ReadingAnswer(BaseModel):
    answer_key: str
    explanation: str
