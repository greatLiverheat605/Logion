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


class ImportPreviewCreate(Strict):
    id: UUID
    source_format: Literal["logion_json", "markdown", "csv", "bibtex"]
    source_filename: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ]
    content: Annotated[str, StringConstraints(min_length=1, max_length=1_048_576)]


class ImportPreviewResponse(Strict):
    id: UUID
    workspace_id: UUID
    source_format: Literal["logion_json", "markdown", "csv", "bibtex"]
    source_filename: str
    source_sha256: str
    counts: dict[str, int]
    warnings: list[str]
    status: Literal["previewed", "imported", "expired"]
    imported_space_id: UUID | None
    version: int
    created_at: datetime
    imported_at: datetime | None
    expires_at: datetime


class ImportPreviewList(Strict):
    imports: list[ImportPreviewResponse]


class ImportCommit(Strict):
    target_space_id: UUID
    expected_version: int = Field(ge=1)
    confirmation: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^IMPORT$")]
