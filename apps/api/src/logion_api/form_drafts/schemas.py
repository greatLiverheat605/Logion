from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DraftKind = Literal[
    "source_create",
    "source_edit",
    "idea_create",
    "idea_edit",
    "question_create",
    "question_edit",
    "question_split",
    "question_merge",
    "goal_create",
    "goal_edit",
    "phase_edit",
    "topic_create",
    "topic_edit",
    "quiz_create",
    "quiz_edit",
    "memory_answer",
    "reading_answer",
    "weekly_triage",
    "edge_create",
    "reading_question",
]

FIELDS: dict[str, dict[str, int]] = {
    "source_create": {"authors": 200000, "abstract": 30000},
    "source_edit": {"authors": 200000, "abstract": 30000},
    "idea_create": {"body": 100000},
    "idea_edit": {"body": 100000},
    "question_create": {"question": 30000, "rationale": 30000},
    "question_edit": {"question": 30000, "rationale": 30000},
    "question_split": {"children": 600000},
    "question_merge": {"question": 30000, "rationale": 30000},
    "goal_create": {"description": 10000, "desired_outcome": 5000, "criterion": 500},
    "goal_edit": {"description": 10000, "desired_outcome": 5000},
    "phase_edit": {"phases": 1000000},
    "topic_create": {"description": 10000},
    "topic_edit": {"description": 10000},
    "quiz_create": {"prompt": 10000, "answer": 10000, "explanation": 20000},
    "quiz_edit": {"prompt": 10000, "answer": 10000, "explanation": 20000},
    "memory_answer": {"response_text": 20000},
    "reading_answer": {"response_text": 8000},
    "weekly_triage": {"triage": 150000},
    "edge_create": {"reason": 1000},
    "reading_question": {"question": 2000},
}


class DraftWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    expected_id: UUID | None = None
    fields: dict[str, Annotated[str, StringConstraints(strict=True, max_length=1000000)]] = Field(
        max_length=8
    )


class DraftView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    form_kind: DraftKind
    target_key: UUID
    fields: dict[str, str]
    version: int
    updated_at: datetime
    expires_at: datetime


class DraftResponse(BaseModel):
    draft: DraftView | None
