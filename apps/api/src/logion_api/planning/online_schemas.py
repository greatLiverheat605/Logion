from datetime import date, datetime

from pydantic import Field, model_validator

from logion_api.planning.schemas import (
    Description,
    GoalPlanResponse,
    Outcome,
    PhaseResponse,
    StrictModel,
    Title,
)


class OnlineGoalUpdate(StrictModel):
    expected_version: int = Field(ge=1)
    title: Title | None = None
    description: Description | None = None
    desired_outcome: Outcome | None = None
    weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    target_date: date | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "OnlineGoalUpdate":
        fields = self.model_fields_set - {"expected_version"}
        if not fields:
            raise ValueError("At least one goal field is required.")
        if any(getattr(self, name) is None for name in fields - {"target_date"}):
            raise ValueError("Only target_date may be cleared with null.")
        return self


class OnlinePhaseView(PhaseResponse):
    archived_at: datetime | None
    removal_allowed: bool


class OnlineGoalView(GoalPlanResponse):
    phases: list[OnlinePhaseView]  # type: ignore[assignment]


class OnlineGoalPage(StrictModel):
    goals: list[OnlineGoalView]
