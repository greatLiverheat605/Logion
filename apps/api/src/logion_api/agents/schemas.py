import json
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from logion_api.knowledge.schemas import EdgeCreate
from logion_api.library.schemas import CSL, LibraryCreate

AgentScope = Literal["read", "inbox:write"]
AgentKind = Literal["source", "report", "summary", "edge"]
AgentStatus = Literal["pending", "accepted", "discarded"]
Label = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[^\x00]*$"),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)


class AgentTokenCreate(Strict):
    workspace_id: UUID
    space_id: UUID
    name: Label
    scopes: list[AgentScope] = Field(min_length=1, max_length=2)
    expires_at: datetime

    @model_validator(mode="after")
    def valid(self) -> "AgentTokenCreate":
        if self.expires_at.utcoffset() is None or len(self.scopes) != len(set(self.scopes)):
            raise ValueError("Use a timezone-aware expiry and distinct scopes")
        return self


class AgentTokenView(Strict):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    name: str
    scopes: list[AgentScope]
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class AgentTokenIssued(Strict):
    token: str
    detail: AgentTokenView


class AgentTokenPage(Strict):
    tokens: list[AgentTokenView]
    next_cursor: UUID | None = None


class AgentSource(Strict):
    kind: Literal["source"]
    title: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=300, pattern=r"^[^\x00]*$"
        ),
    ]
    resource_type: Literal["paper", "book", "preprint", "web"] = "paper"
    source_url: str | None = Field(default=None, max_length=4096)
    csl: CSL = Field(default_factory=CSL)
    doi: str | None = Field(default=None, max_length=255)
    arxiv_id: str | None = Field(default=None, max_length=80)
    pmid: str | None = Field(default=None, max_length=20)
    citation_key: str | None = Field(default=None, max_length=160)

    def library(self) -> LibraryCreate:
        return LibraryCreate.model_validate(self.model_dump(exclude={"kind"}, by_alias=True))

    @model_validator(mode="after")
    def valid_source(self) -> "AgentSource":
        value = self.library()
        self.doi, self.arxiv_id, self.pmid = value.doi, value.arxiv_id, value.pmid
        return self


class AgentNote(Strict):
    kind: Literal["report", "summary"]
    title: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=200, pattern=r"^[^\x00]*$"
        ),
    ]
    markdown_body: Annotated[
        str, StringConstraints(min_length=1, max_length=50000, pattern=r"^[^\x00]*$")
    ]


class AgentEdge(EdgeCreate):
    kind: Literal["edge"]
    from_type: Literal["resource", "claim"]
    to_type: Literal["resource", "question", "topic"]

    def edge(self) -> EdgeCreate:
        return EdgeCreate.model_validate(self.model_dump(exclude={"kind"}))


AgentPayload = Annotated[AgentSource | AgentNote | AgentEdge, Field(discriminator="kind")]


class AgentSubmission(Strict):
    submission_key: Annotated[
        str, StringConstraints(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    ]
    payload: AgentPayload

    @model_validator(mode="after")
    def bounded(self) -> "AgentSubmission":
        bounded_payload(self.payload)
        return self


def bounded_payload(payload: AgentPayload) -> None:
    if len(json.dumps(payload.model_dump(mode="json"), ensure_ascii=False).encode()) > 65536:
        raise ValueError("Inbox payload exceeds 64 KiB")


class AgentDecision(Strict):
    expected_version: int = Field(ge=1)
    decision: Literal["accepted", "discarded"]
    payload: AgentPayload | None = None

    @model_validator(mode="after")
    def valid_decision(self) -> "AgentDecision":
        if self.decision == "discarded" and self.payload is not None:
            raise ValueError("Discard does not accept replacement content")
        if self.payload is not None:
            bounded_payload(self.payload)
        return self


class AgentInboxView(Strict):
    agent_name: str = ""
    references: list[str] = Field(default_factory=list)
    id: UUID
    token_id: UUID
    kind: AgentKind
    payload: AgentPayload
    status: AgentStatus
    version: int
    receipt: dict[str, str] | None
    accepted_payload: AgentPayload | None
    created_at: datetime
    decided_at: datetime | None


class AgentInboxPage(Strict):
    items: list[AgentInboxView]
    next_cursor: UUID | None = None


class AgentSubmissionReceipt(Strict):
    id: UUID
    status: AgentStatus


class AgentEntity(Strict):
    entity_type: Literal[
        "resource",
        "source_text",
        "source_excerpt",
        "note",
        "research_question",
        "topic",
        "research_claim",
    ]
    id: UUID
    version: int
    data: dict[str, object]


class AgentEntityPage(Strict):
    items: list[AgentEntity]
    next_cursor: UUID | None = None
