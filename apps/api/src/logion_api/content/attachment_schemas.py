from datetime import datetime
from pathlib import PurePath
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

ALLOWED_ATTACHMENT_EXTENSIONS: dict[str, frozenset[str]] = {
    "image/png": frozenset({".png"}),
    "image/jpeg": frozenset({".jpg", ".jpeg"}),
    "image/webp": frozenset({".webp"}),
    "application/pdf": frozenset({".pdf"}),
    "application/json": frozenset({".json"}),
    "text/plain": frozenset({".txt", ".log", ".md"}),
    "text/csv": frozenset({".csv"}),
}
AttachmentTargetType = Literal["note", "evidence_item", "experiment_run"]
AttachmentStatus = Literal["pending_upload", "uploading", "verified", "failed", "deleted"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AttachmentInit(Strict):
    id: UUID
    target_type: AttachmentTargetType
    target_id: UUID
    filename: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    declared_mime: Literal[
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
        "application/json",
        "text/plain",
        "text/csv",
    ]
    size_bytes: int = Field(ge=1, le=100 * 1024 * 1024)
    sha256: Annotated[str, StringConstraints(pattern=r"^(?:sha256:)?[0-9a-f]{64}$")]

    @field_validator("filename")
    @classmethod
    def filename_is_metadata_only(cls, value: str) -> str:
        if any(ord(character) < 32 for character in value) or any(
            separator in value for separator in ("/", "\\")
        ):
            raise ValueError("filename cannot contain paths or control characters")
        return value

    @field_validator("sha256")
    @classmethod
    def normalize_sha256(cls, value: str) -> str:
        return value.removeprefix("sha256:")

    @model_validator(mode="after")
    def extension_matches_declared_mime(self) -> "AttachmentInit":
        suffix = PurePath(self.filename).suffix.casefold()
        if suffix not in ALLOWED_ATTACHMENT_EXTENSIONS[self.declared_mime]:
            raise ValueError("filename extension does not match declared_mime")
        return self


class AttachmentComplete(Strict):
    expected_version: int = Field(ge=1)


class AttachmentResponse(Strict):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    target_type: AttachmentTargetType
    target_id: UUID
    filename: str
    declared_mime: str
    detected_mime: str | None
    size_bytes: int
    expected_sha256: str
    verified_sha256: str | None
    status: AttachmentStatus
    failure_code: str | None
    version: int
    created_at: datetime
    updated_at: datetime
    verified_at: datetime | None
