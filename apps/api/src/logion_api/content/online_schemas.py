from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from logion_api.content.schemas import NoteDocumentUpdate

OnlineNoteTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class OnlineNoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    title: OnlineNoteTitle


class OnlineNoteRename(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    title: OnlineNoteTitle


class OnlineNoteUpdate(NoteDocumentUpdate):
    base_version: int = Field(ge=1)


class OnlineNoteSummary(BaseModel):
    id: UUID
    title: str
    note_kind: Literal["close_reading"] | None
    resource_id: UUID | None
    version: int
    updated_at: datetime


class OnlineNotePage(BaseModel):
    notes: list[OnlineNoteSummary]
    next_cursor: UUID | None
    can_create: bool


class OnlineNoteDetail(OnlineNoteSummary):
    markdown_body: str
    yjs_state_base64: str
    yjs_generation: int
    can_edit: bool
    source_available: bool
