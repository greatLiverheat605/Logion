from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TaskCreateRequest(StrictModel):
    id: UUID
    goal_id: UUID
    phase_id: UUID | None = None
    title: Title
    description: Description = ""
    priority: int = Field(default=2, ge=0, le=4)
    estimated_minutes: int = Field(default=0, ge=0, le=1_000_000)
    planned_at: datetime | None = None
    due_at: datetime | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskCreateRequest":
        for value in (self.planned_at, self.due_at):
            if value is not None and value.tzinfo is None:
                raise ValueError("task dates must include a timezone")
        if self.planned_at and self.due_at and self.due_at < self.planned_at:
            raise ValueError("due_at cannot precede planned_at")
        return self


TaskStatus = Literal[
    "backlog",
    "planned",
    "in_progress",
    "submitted",
    "verified",
    "done",
    "blocked",
    "cancelled",
]


class TaskTransitionRequest(StrictModel):
    expected_version: int = Field(ge=1)
    status: TaskStatus
    blocked_reason: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None
    ) = None

    @model_validator(mode="after")
    def validate_blocked_reason(self) -> "TaskTransitionRequest":
        if self.status == "blocked" and not self.blocked_reason:
            raise ValueError("a blocked task requires a reason")
        if self.status != "blocked" and self.blocked_reason is not None:
            raise ValueError("blocked_reason is only valid for a blocked task")
        return self


class TaskResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    goal_id: UUID
    phase_id: UUID | None
    title: str
    description: str
    status: TaskStatus
    priority: int
    estimated_minutes: int
    planned_at: datetime | None
    due_at: datetime | None
    blocked_reason: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class SessionStartRequest(StrictModel):
    id: UUID
    task_id: UUID


class SessionFinishRequest(StrictModel):
    expected_version: int = Field(ge=1)
    outcome: Literal["completed", "abandoned"]
    manual_minutes: int | None = Field(default=None, ge=0, le=1440)
    reflection: Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)] = ""


class SessionResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    task_id: UUID
    status: Literal["active", "completed", "abandoned"]
    started_at: datetime
    ended_at: datetime | None
    manual_minutes: int | None
    reflection: str
    version: int
