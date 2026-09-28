import re
from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
ReadingStatus = Literal["unread", "skimmed", "reading", "close_read", "archived"]
ResourceType = Literal["link", "pdf_index", "paper", "book", "preprint", "web"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, from_attributes=True)


def safe_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise ValueError("An HTTP(S) URL without credentials is required")
    return value


class Author(Strict):
    family: Text | None = None
    given: Text | None = None
    literal: Text | None = None


class Issued(Strict):
    date_parts: list[list[int]] = Field(alias="date-parts", min_length=1, max_length=1)

    @field_validator("date_parts")
    @classmethod
    def validate_date(cls, value: list[list[int]]) -> list[list[int]]:
        parts = value[0]
        if not 1 <= len(parts) <= 3 or not 1 <= parts[0] <= 9999:
            raise ValueError("Invalid CSL date")
        datetime(parts[0], parts[1] if len(parts) > 1 else 1, parts[2] if len(parts) > 2 else 1)
        return value


class CSL(Strict):
    author: list[Author] = Field(default_factory=list, max_length=100)
    issued: Issued | None = None
    container_title: Text | None = Field(default=None, alias="container-title")
    volume: Text | None = None
    issue: Text | None = None
    page: Text | None = None
    abstract: Annotated[str, StringConstraints(max_length=30000)] | None = None
    language: Annotated[str, StringConstraints(max_length=80)] | None = None


class FileLocator(Strict):
    kind: Literal["zotero_webdav", "logion_webdav", "url"]
    path: Text
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None = None
    size: int | None = Field(default=None, ge=0)

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        if not value or "\0" in value or "\\" in value or ".." in value.split("/"):
            raise ValueError("Invalid file locator")
        if "://" in value:
            safe_url(value)
        return value


class LibraryFields(Strict):
    resource_type: ResourceType = "paper"
    title: Title
    source_url: Annotated[str, StringConstraints(max_length=4096)] | None = None
    csl: CSL = Field(default_factory=CSL)
    doi: Annotated[str, StringConstraints(max_length=255)] | None = None
    arxiv_id: Annotated[str, StringConstraints(max_length=80)] | None = None
    pmid: Annotated[str, StringConstraints(max_length=20)] | None = None
    citation_key: Annotated[str, StringConstraints(max_length=160)] | None = None
    tags: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    ] = Field(default_factory=list, max_length=50)
    zotero_library_id: Annotated[str, StringConstraints(max_length=80)] | None = None
    zotero_item_key: Annotated[str, StringConstraints(max_length=80)] | None = None
    zotero_version: int | None = Field(default=None, ge=0)
    file_locator: FileLocator | None = None
    reading_status: ReadingStatus = "unread"
    read_at: datetime | None = None

    @field_validator("source_url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        return safe_url(value) if value else None

    @field_validator("doi")
    @classmethod
    def normalize_doi(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = re.sub(
            r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", value.strip(), flags=re.I
        ).lower()
        if not re.fullmatch(r"10\.\d{4,9}/[^\s]+", value):
            raise ValueError("Invalid DOI")
        return value

    @field_validator("arxiv_id")
    @classmethod
    def normalize_arxiv(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = re.sub(
            r"^(?:https?://arxiv\.org/(?:abs|pdf)/|arxiv:\s*)", "", value.strip(), flags=re.I
        )
        value = re.sub(r"(?:v\d+)?(?:\.pdf)?$", "", value, flags=re.I).lower()
        if not re.fullmatch(r"(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?/\d{7})", value):
            raise ValueError("Invalid arXiv identifier")
        return value

    @field_validator("pmid")
    @classmethod
    def normalize_pmid(cls, value: str | None) -> str | None:
        if not value:
            return None
        if not value.strip().isascii() or not value.strip().isdigit() or int(value) < 1:
            raise ValueError("Invalid PMID")
        return str(int(value))

    @field_validator("tags")
    @classmethod
    def unique_tags(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

    @field_validator("read_at")
    @classmethod
    def aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("read_at must include a timezone")
        return value


class LibraryCreate(LibraryFields):
    pass


class LibraryUpdate(LibraryFields):
    expected_version: int = Field(ge=1)


class LibraryDelete(Strict):
    expected_version: int = Field(ge=1)


class LibraryResource(LibraryFields):
    zotero_attachment_version: int | None = None
    id: UUID
    workspace_id: UUID
    space_id: UUID
    version: int
    created_at: datetime
    updated_at: datetime


class LibraryPage(Strict):
    resources: list[LibraryResource]
    next_cursor: UUID | None = None
