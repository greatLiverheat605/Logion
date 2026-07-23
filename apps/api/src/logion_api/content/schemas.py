import base64
import binascii
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoteWriteRequest(StrictModel):
    id: UUID
    task_id: UUID | None = None
    title: Title
    markdown_body: Annotated[str, StringConstraints(max_length=500_000)] = ""


class NoteUpdateRequest(StrictModel):
    expected_version: int = Field(ge=1)
    task_id: UUID | None = None
    title: Title
    markdown_body: Annotated[str, StringConstraints(max_length=500_000)] = ""


class NoteResponse(NoteWriteRequest):
    workspace_id: UUID
    space_id: UUID
    version: int


class NoteDocumentUpdate(StrictModel):
    space_id: UUID
    yjs_generation: int = Field(ge=1)
    update_base64: Annotated[str, StringConstraints(min_length=4, max_length=240_000)]

    def decoded_update(self) -> bytes:
        try:
            decoded = base64.b64decode(self.update_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("update_base64 must be canonical base64") from exc
        if base64.b64encode(decoded).decode("ascii") != self.update_base64:
            raise ValueError("update_base64 must be canonical base64")
        return decoded


class PageIndexEntry(StrictModel):
    page: int = Field(ge=1, le=100_000)
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class ResourceFields(StrictModel):
    task_id: UUID | None = None
    resource_type: Literal["link", "pdf_index"]
    title: Title
    source_url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4096)] | None = (
        None
    )
    pdf_filename: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
        | None
    ) = None
    page_count: int | None = Field(default=None, ge=1, le=100_000)
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    page_index: list[PageIndexEntry] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def validate_shape(self) -> "ResourceFields":
        if self.source_url is not None:
            parsed = urlsplit(self.source_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("source_url must use http or https")
        if self.resource_type == "link" and self.source_url is None:
            raise ValueError("a link resource requires source_url")
        if self.resource_type == "link" and any(
            value is not None for value in (self.pdf_filename, self.page_count, self.sha256)
        ):
            raise ValueError("link resources cannot contain PDF metadata")
        if self.resource_type == "pdf_index" and (
            self.pdf_filename is None or self.page_count is None
        ):
            raise ValueError("a PDF index requires filename and page_count")
        pages = [entry.page for entry in self.page_index]
        if len(pages) != len(set(pages)):
            raise ValueError("PDF page index entries must be unique")
        if self.page_count is not None and any(page > self.page_count for page in pages):
            raise ValueError("page index exceeds page_count")
        return self


class ResourceCreateRequest(ResourceFields):
    id: UUID


class ResourceUpdateRequest(ResourceFields):
    expected_version: int = Field(ge=1)


class ResourceResponse(ResourceCreateRequest):
    workspace_id: UUID
    space_id: UUID
    version: int
