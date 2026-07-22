from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExportCreate(Strict):
    id: UUID
    confirmation: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^EXPORT$")]


class ExportResponse(Strict):
    id: UUID
    workspace_id: UUID
    status: Literal["queued", "running", "succeeded", "failed", "cancelled", "expired"]
    schema_version: str
    artifact_sha256: str | None
    artifact_bytes: int | None
    error_code: str | None
    version: int
    created_at: datetime
    completed_at: datetime | None
    expires_at: datetime


class ExportList(Strict):
    exports: list[ExportResponse]


class ExportCancel(Strict):
    expected_version: int = Field(ge=1)
