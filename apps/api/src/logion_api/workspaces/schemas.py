from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from logion_api.workspaces.permissions import (
    MembershipStatus,
    SpaceStatus,
    SpaceVisibility,
    WorkspaceRole,
    WorkspaceStatus,
)

WorkspaceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]


class WorkspaceCreateRequest(BaseModel):
    name: WorkspaceName


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    status: WorkspaceStatus
    version: int
    role: WorkspaceRole
    membership_status: MembershipStatus
    created_at: datetime
    updated_at: datetime


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceResponse]


class SpaceCreateRequest(BaseModel):
    name: WorkspaceName
    visibility: SpaceVisibility


class SpaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    owner_user_id: UUID | None
    name: str
    visibility: SpaceVisibility
    status: SpaceStatus
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime


class SpaceListResponse(BaseModel):
    spaces: list[SpaceResponse]
