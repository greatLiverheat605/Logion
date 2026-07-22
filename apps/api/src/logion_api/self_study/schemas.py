from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=20000)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TrackCreateRequest(StrictModel):
    id: UUID
    title: Title
    objective: Text = ""


class ProjectCreateRequest(StrictModel):
    id: UUID
    track_id: UUID
    title: Title
    intended_outcome: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)
    ]


class InboxItemCreateRequest(StrictModel):
    id: UUID
    title: Title
    note: Text = ""


class DeliverableCreateRequest(StrictModel):
    id: UUID
    project_id: UUID
    title: Title
    evidence_summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)
    ]
    completed_at: datetime

    @model_validator(mode="after")
    def require_aware_completion(self) -> "DeliverableCreateRequest":
        if self.completed_at.utcoffset() is None:
            raise ValueError("completion time must include a timezone")
        return self


class TrackResponse(TrackCreateRequest):
    workspace_id: UUID
    space_id: UUID
    version: int


class ProjectResponse(ProjectCreateRequest):
    version: int


class InboxItemResponse(InboxItemCreateRequest):
    version: int


class DeliverableResponse(DeliverableCreateRequest):
    version: int


class SelfStudyListResponse(StrictModel):
    tracks: list[TrackResponse]
    projects: list[ProjectResponse]
    inbox_items: list[InboxItemResponse]
    deliverables: list[DeliverableResponse]
