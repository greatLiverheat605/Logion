from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
TaskType = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-z][a-z0-9_.-]*$",
    ),
]
Currency = Annotated[str, StringConstraints(to_upper=True, pattern=r"^[A-Z]{3}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AIModelCreate(Strict):
    id: UUID
    provider_id: UUID
    provider_model_id: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    enabled: bool = True
    supports_json: bool = False
    supports_stream: bool = False
    context_window: int | None = Field(default=None, ge=1, le=10_000_000)
    pricing_currency: Currency = "USD"
    input_cost_per_million_minor: int = Field(default=0, ge=0, le=1_000_000_000)
    output_cost_per_million_minor: int = Field(default=0, ge=0, le=1_000_000_000)


class AIModelUpdate(Strict):
    expected_version: int = Field(ge=1)
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    enabled: bool
    supports_json: bool
    supports_stream: bool
    context_window: int | None = Field(default=None, ge=1, le=10_000_000)
    pricing_currency: Currency
    input_cost_per_million_minor: int = Field(ge=0, le=1_000_000_000)
    output_cost_per_million_minor: int = Field(ge=0, le=1_000_000_000)


class AIWorkspaceBudgetUpdate(Strict):
    expected_version: int | None = Field(default=None, ge=1)
    monthly_token_budget: int | None = Field(default=None, ge=1, le=10_000_000_000)
    monthly_cost_budget_minor: int | None = Field(default=None, ge=1, le=10_000_000_000)
    currency: Currency = "USD"


class AIWorkspaceBudgetResponse(Strict):
    workspace_id: UUID
    monthly_token_budget: int | None
    monthly_cost_budget_minor: int | None
    currency: str
    version: int


class AITaskRouteWrite(Strict):
    name: Name
    task_type: TaskType
    requires_json: bool = False
    requires_stream: bool = False
    max_input_tokens: int = Field(ge=1, le=10_000_000)
    max_output_tokens: int = Field(ge=1, le=1_000_000)
    enabled: bool = True
    model_ids: list[UUID] = Field(min_length=1, max_length=10)

    @field_validator("model_ids")
    @classmethod
    def unique_models(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("model_ids must be unique")
        return value


class AITaskRouteCreate(AITaskRouteWrite):
    id: UUID


class AITaskRouteUpdate(AITaskRouteWrite):
    expected_version: int = Field(ge=1)


class AITaskRouteDelete(Strict):
    expected_version: int = Field(ge=1)


class AITaskRouteResponse(Strict):
    id: UUID
    workspace_id: UUID
    name: str
    task_type: str
    requires_json: bool
    requires_stream: bool
    max_input_tokens: int
    max_output_tokens: int
    enabled: bool
    model_ids: list[UUID]
    version: int


class AITaskRouteList(Strict):
    routes: list[AITaskRouteResponse]


class AIRouteResolveRequest(Strict):
    task_type: TaskType
    estimated_input_tokens: int = Field(ge=1, le=10_000_000)
    requested_output_tokens: int = Field(ge=1, le=1_000_000)


class AIRouteCandidate(Strict):
    model_id: UUID
    provider_id: UUID
    position: int
    estimated_tokens: int
    estimated_cost_minor: int
    currency: str
    selection: Literal["primary", "fallback"]


class AIRouteResolveResponse(Strict):
    route_id: UUID
    task_type: str
    candidates: list[AIRouteCandidate]
    monthly_token_budget: int | None
    monthly_cost_budget_minor: int | None
    currency: str
