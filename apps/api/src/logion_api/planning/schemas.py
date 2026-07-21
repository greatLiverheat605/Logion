from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]
Outcome = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
Criterion = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PhaseCreate(StrictModel):
    id: UUID
    title: Title
    description: Description = ""
    position: int = Field(ge=0, le=999)
    estimated_minutes: int = Field(ge=0, le=1_000_000)
    acceptance_criteria: list[Criterion] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_criteria(self) -> "PhaseCreate":
        if len(self.acceptance_criteria) != len(set(self.acceptance_criteria)):
            raise ValueError("acceptance criteria must be unique")
        return self


class GoalPlanCreateRequest(StrictModel):
    goal_id: UUID
    plan_id: UUID
    plan_version_id: UUID
    title: Title
    description: Description = ""
    desired_outcome: Outcome
    weekly_minutes: int = Field(ge=0, le=10080)
    target_date: date | None = None
    phases: list[PhaseCreate] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_identifiers_and_positions(self) -> "GoalPlanCreateRequest":
        ids = [
            self.goal_id,
            self.plan_id,
            self.plan_version_id,
            *(phase.id for phase in self.phases),
        ]
        if len(ids) != len(set(ids)):
            raise ValueError("planning IDs must be unique")
        positions = sorted(phase.position for phase in self.phases)
        if positions != list(range(len(self.phases))):
            raise ValueError("phase positions must be contiguous from zero")
        return self


class PhaseResponse(StrictModel):
    id: UUID
    title: str
    description: str
    position: int
    estimated_minutes: int
    acceptance_criteria: list[str]


class GoalPlanResponse(StrictModel):
    goal_id: UUID
    plan_id: UUID
    plan_version_id: UUID
    workspace_id: UUID
    space_id: UUID
    title: str
    description: str
    desired_outcome: str
    weekly_minutes: int
    target_date: date | None
    goal_status: Literal["draft", "active", "completed", "archived"]
    plan_status: Literal["draft", "active", "archived"]
    plan_version_status: Literal["draft", "published", "superseded"]
    goal_version: int
    plan_version: int
    version_number: int
    created_at: datetime
    phases: list[PhaseResponse]


class GoalPlanListResponse(StrictModel):
    goals: list[GoalPlanResponse]


class PlanPublishRequest(StrictModel):
    expected_goal_version: int = Field(ge=1)
    expected_plan_version: int = Field(ge=1)
    change_summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""
