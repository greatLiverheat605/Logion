from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

NodeKind = Literal["resource", "question", "topic", "claim", "idea"]
Relation = Literal[
    "addresses",
    "defines",
    "uses",
    "extends",
    "contradicts",
    "supersedes",
    "supports",
    "challenges",
    "inspired_by",
]
RELATIONS = {
    ("resource", "question"): {"addresses"},
    ("resource", "topic"): {"defines", "uses"},
    ("resource", "resource"): {"extends", "contradicts", "supersedes"},
    ("claim", "question"): {"supports", "challenges"},
    ("idea", "resource"): {"inspired_by"},
}
Reason = Annotated[str, StringConstraints(max_length=1000, pattern=r"^[^\x00]*$")]


class EdgeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    from_type: NodeKind
    from_id: UUID
    to_type: NodeKind
    to_id: UUID
    relation: Relation
    reason: Reason = ""
    evidence_excerpt_id: UUID | None = None

    @model_validator(mode="after")
    def valid_relation(self) -> "EdgeCreate":
        if self.relation not in RELATIONS.get((self.from_type, self.to_type), set()):
            raise ValueError("This relation is not valid for these endpoint types")
        if (self.from_type, self.from_id) == (self.to_type, self.to_id):
            raise ValueError("An edge cannot link an entity to itself")
        return self


class EdgeView(EdgeCreate):
    id: UUID
    status: Literal["suggested", "confirmed", "rejected"]
    origin: Literal["user", "ai"]
    ai_run_id: UUID | None
    version: int
    created_at: datetime
    decided_at: datetime | None


class EdgePage(BaseModel):
    edges: list[EdgeView]
    next_cursor: UUID | None = None


class EdgeDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["confirmed", "rejected"]
    expected_version: int = Field(ge=1)


SourceLabel = Annotated[str, StringConstraints(pattern=r"^source_([0-9]|[12][0-9]|3[01])$")]


class LinkSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_source: SourceLabel
    to_source: SourceLabel
    relation: Relation
    reason: Annotated[str, StringConstraints(min_length=1, max_length=1000, strip_whitespace=True)]
    evidence_source: SourceLabel | None = None


class LinkSuggestions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    links: list[LinkSuggestion] = Field(max_length=50)
