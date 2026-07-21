from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceSubmitRequest(StrictModel):
    evidence_id: UUID
    verification_id: UUID
    task_id: UUID
    evidence_type: Literal["text", "link", "note", "resource"]
    note_id: UUID | None = None
    resource_id: UUID | None = None
    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)] = ""
    external_url: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=4096)] | None
    ) = None

    @model_validator(mode="after")
    def validate_shape(self) -> "EvidenceSubmitRequest":
        if self.evidence_id == self.verification_id:
            raise ValueError("evidence and verification identifiers must differ")
        expected_note = self.evidence_type == "note"
        expected_resource = self.evidence_type == "resource"
        if (self.note_id is not None) != expected_note or (
            self.resource_id is not None
        ) != expected_resource:
            raise ValueError("evidence reference does not match its type")
        if self.evidence_type == "text" and not self.summary:
            raise ValueError("text evidence requires a summary")
        if self.evidence_type == "link":
            if self.external_url is None:
                raise ValueError("link evidence requires external_url")
            parsed = urlsplit(self.external_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("external_url must use http or https")
        elif self.external_url is not None:
            raise ValueError("external_url is only valid for link evidence")
        return self


class VerificationDecisionRequest(StrictModel):
    expected_version: int = Field(ge=1)
    verdict: Literal["passed", "failed", "needs_revision"]
    reviewer_notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)] = ""


class TaskCloseRequest(StrictModel):
    expected_task_version: int = Field(ge=1)


class EvidenceResponse(StrictModel):
    evidence_id: UUID
    verification_id: UUID
    task_id: UUID
    evidence_type: Literal["text", "link", "note", "resource"]
    summary: str
    external_url: str | None
    note_id: UUID | None
    resource_id: UUID | None
    evidence_version: int
    verification_version: int
    verdict: Literal["pending", "passed", "failed", "needs_revision"]
    task_status: Literal[
        "backlog", "planned", "in_progress", "submitted", "verified", "done", "blocked", "cancelled"
    ]
    task_version: int


class VerificationResponse(StrictModel):
    verification_id: UUID
    evidence_id: UUID
    task_id: UUID
    verdict: Literal["pending", "passed", "failed", "needs_revision"]
    reviewer_notes: str
    version: int
    task_status: Literal["in_progress", "submitted", "verified", "done"]
    task_version: int
