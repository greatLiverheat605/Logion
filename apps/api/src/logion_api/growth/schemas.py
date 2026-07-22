from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Locale = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=2, max_length=35, pattern=r"^[A-Za-z0-9-]+$"
    ),
]
Persona = Annotated[
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


class TemplateFromGoalCreate(Strict):
    id: UUID
    template_key: UUID
    previous_template_id: UUID | None = None
    source_space_id: UUID
    source_goal_id: UUID
    name: ShortText
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""
    product_min_version: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32)
    ] = "0.1.0"
    author_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
    ]
    license: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    locale: Locale = "zh-CN"
    target_personas: list[Persona] = Field(min_length=1, max_length=12)
    changelog: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    visibility: Literal["private", "workspace"] = "private"

    @field_validator("target_personas")
    @classmethod
    def personas_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("target_personas must be unique")
        return value


class TemplatePackageResponse(Strict):
    id: UUID
    workspace_id: UUID
    template_key: UUID
    version_number: int
    name: str
    description: str
    schema_version: int
    product_min_version: str
    author_name: str
    license: str
    locale: str
    target_personas: list[str]
    changelog: str
    content_hash: str
    risk_metadata: dict[str, object]
    object_graph: dict[str, object]
    visibility: Literal["private", "workspace"]
    status: Literal["active", "withdrawn"]
    created_at: datetime


class TemplatePackageList(Strict):
    templates: list[TemplatePackageResponse]


class TemplateInstall(Strict):
    id: UUID
    template_id: UUID
    target_space_id: UUID


class TemplateInstallationResponse(Strict):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    template_id: UUID
    template_content_hash: str
    installed_object_ids: dict[str, object]
    created_at: datetime


ShareField = Literal[
    "title",
    "description",
    "desired_outcome",
    "status",
    "weekly_minutes",
    "target_date",
    "phases",
]


class ShareSnapshotCreate(Strict):
    id: UUID
    source_space_id: UUID
    source_goal_id: UUID
    title: ShortText
    fields: list[ShareField] = Field(min_length=1, max_length=7)
    expires_in_days: int = Field(default=30, ge=1, le=365)

    @field_validator("fields")
    @classmethod
    def fields_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("fields must be unique")
        return value


class ShareSnapshotResponse(Strict):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    object_type: Literal["goal_plan"]
    object_id: UUID
    title: str
    status: Literal["active", "revoked"]
    version: int
    expires_at: datetime
    created_at: datetime


class ShareSnapshotCreated(ShareSnapshotResponse):
    token: str


class ShareSnapshotList(Strict):
    shares: list[ShareSnapshotResponse]


class ShareSnapshotRevoke(Strict):
    expected_version: int = Field(ge=1)


class PublicShareResponse(Strict):
    title: str
    object_type: Literal["goal_plan"]
    snapshot: dict[str, object]
    expires_at: datetime
