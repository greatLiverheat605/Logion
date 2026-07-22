from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

FieldName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[a-zA-Z][a-zA-Z0-9_.-]*$"
    ),
]
FieldValue = Annotated[str, StringConstraints(max_length=100_000)]
ObjectType = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z][a-z0-9_.-]*$",
    ),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AIRunCreate(Strict):
    id: UUID
    idempotency_key: UUID
    task_type: ObjectType
    target_type: ObjectType
    target_id: UUID
    target_version: int = Field(ge=1)
    input_fields: dict[FieldName, FieldValue] = Field(min_length=1, max_length=32)
    expected_output_fields: list[FieldName] = Field(min_length=1, max_length=32)
    requested_output_tokens: int = Field(ge=1, le=100_000)
    retain_input: bool = False
    send_confirmed: Literal[True]

    @field_validator("expected_output_fields")
    @classmethod
    def output_fields_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("expected_output_fields must be unique")
        return value


class AIRunResponse(Strict):
    id: UUID
    workspace_id: UUID
    route_id: UUID
    task_type: str
    target_type: str
    target_id: UUID
    target_version: int
    selected_fields: list[str]
    expected_output_fields: list[str]
    retain_input: bool
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    estimated_input_tokens: int
    requested_output_tokens: int
    reserved_tokens: int
    reserved_cost_minor: int
    actual_input_tokens: int | None
    actual_output_tokens: int | None
    actual_cost_minor: int | None
    currency: str
    attempt_count: int
    selected_model_id: UUID | None
    selected_provider_id: UUID | None
    selected_candidate_position: int | None
    error_code: str | None
    cancel_requested_at: datetime | None
    version: int
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class AIRunList(Strict):
    runs: list[AIRunResponse]


class AIRunCancel(Strict):
    expected_version: int = Field(ge=1)


class AIOutputDraftResponse(Strict):
    id: UUID
    workspace_id: UUID
    run_id: UUID
    target_type: str
    target_id: UUID
    target_version: int
    structured_output: dict[str, str]
    edited_output: dict[str, str] | None
    status: Literal["pending", "accepted", "rejected"]
    decision_note: str | None
    version: int
    created_at: datetime
    decided_at: datetime | None


class AIOutputDraftList(Strict):
    drafts: list[AIOutputDraftResponse]


class AIOutputDraftDecision(Strict):
    expected_version: int = Field(ge=1)
    decision: Literal["accepted", "rejected"]
    edited_output: dict[FieldName, FieldValue] | None = Field(default=None, max_length=32)
    decision_note: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None
    ) = None
