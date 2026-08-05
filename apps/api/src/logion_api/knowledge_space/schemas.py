from datetime import datetime
from enum import StrEnum
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

EXCERPT_MAX_BYTES = 32 * 1024
EXCERPT_MAX_SCALARS = 20_000
SOURCE_VERSION_MAX_BYTES = 512
RELATION_NOTE_MAX_BYTES = 8 * 1024
RELATION_NOTE_MAX_SCALARS = 2_000
LIST_DEFAULT_PAGE_SIZE = 25
LIST_MAX_PAGE_SIZE = 100
GRAPH_MAX_DEPTH = 2
GRAPH_MAX_NODES = 150
GRAPH_MAX_EDGES = 400
GRAPH_MAX_BYTES = 1024 * 1024
CURSOR_MAX_LENGTH = 1024

Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Cursor = Annotated[str, StringConstraints(min_length=1, max_length=CURSOR_MAX_LENGTH)]
DraftFieldName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[a-zA-Z][a-zA-Z0-9_.-]*$",
    ),
]
DraftFieldValue = Annotated[str, StringConstraints(max_length=EXCERPT_MAX_SCALARS)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CitationRelationship(StrEnum):
    SOURCE = "source"
    DEFINITION = "definition"
    SUPPORT = "support"
    CONTRADICTION = "contradiction"
    EXAMPLE = "example"
    DERIVATION = "derivation"


class KnowledgeTargetType(StrEnum):
    TOPIC = "topic"
    QUIZ_ITEM = "quiz_item"
    RESEARCH_CLAIM = "research_claim"
    NOTE = "note"


class KnowledgeLifecycleStatus(StrEnum):
    ACTIVE = "active"
    SUPERSEDED = "superseded"
    DELETED = "deleted"


class SourceLocator(StrictModel):
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    character_start: int | None = Field(default=None, ge=0)
    character_end: int | None = Field(default=None, ge=1)
    section: str | None = Field(default=None, min_length=1, max_length=512)

    @model_validator(mode="after")
    def validate_complete_ranges(self) -> "SourceLocator":
        page_values = (self.page_start, self.page_end)
        character_values = (self.character_start, self.character_end)
        if (page_values[0] is None) != (page_values[1] is None):
            raise ValueError("page_start and page_end must be supplied together")
        if (character_values[0] is None) != (character_values[1] is None):
            raise ValueError("character_start and character_end must be supplied together")
        if (
            self.page_start is not None
            and self.page_end is not None
            and self.page_end < self.page_start
        ):
            raise ValueError("page_end must not precede page_start")
        if (
            self.character_start is not None
            and self.character_end is not None
            and self.character_end <= self.character_start
        ):
            raise ValueError("character_end must be greater than character_start")
        if self.page_start is None and self.character_start is None and self.section is None:
            raise ValueError("at least one complete locator must be supplied")
        return self


def _validate_plain_text(
    value: str,
    *,
    field_name: str,
    max_scalars: int,
    max_bytes: int,
) -> str:
    if len(value) > max_scalars or len(value.encode("utf-8")) > max_bytes:
        raise ValueError(f"{field_name} exceeds its scalar or UTF-8 byte limit")
    if any(
        (ord(character) < 32 and character not in {"\t", "\n"}) or 127 <= ord(character) <= 159
        for character in value
    ):
        raise ValueError(f"{field_name} contains a disallowed control character")
    return value


class SourceExcerptCreateRequest(StrictModel):
    id: UUID
    resource_id: UUID
    excerpt_text: str = Field(min_length=1, max_length=EXCERPT_MAX_SCALARS)
    locator: SourceLocator
    source_version_key: str = Field(min_length=1, max_length=SOURCE_VERSION_MAX_BYTES)
    source_version_sha256: Sha256Hex
    resource_sha256: Sha256Hex | None = None
    normalization_version: Literal["utf8-nfc-lf-v1"] = "utf8-nfc-lf-v1"
    hash_algorithm: Literal["sha256"] = "sha256"

    @field_validator("excerpt_text")
    @classmethod
    def validate_excerpt_text(cls, value: str) -> str:
        return _validate_plain_text(
            value,
            field_name="excerpt_text",
            max_scalars=EXCERPT_MAX_SCALARS,
            max_bytes=EXCERPT_MAX_BYTES,
        )

    @field_validator("source_version_key")
    @classmethod
    def validate_source_version_key(cls, value: str) -> str:
        return _validate_plain_text(
            value,
            field_name="source_version_key",
            max_scalars=SOURCE_VERSION_MAX_BYTES,
            max_bytes=SOURCE_VERSION_MAX_BYTES,
        )


class SourceExcerptResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    resource_id: UUID
    excerpt_text: str = Field(min_length=1, max_length=EXCERPT_MAX_SCALARS)
    locator: SourceLocator
    source_version_key: str = Field(min_length=1, max_length=SOURCE_VERSION_MAX_BYTES)
    source_version_sha256: Sha256Hex
    resource_sha256: Sha256Hex | None
    excerpt_sha256: Sha256Hex
    normalization_version: Literal["utf8-nfc-lf-v1"]
    hash_algorithm: Literal["sha256"]
    stale: bool
    status: KnowledgeLifecycleStatus
    version: int = Field(ge=1)
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class SourceExcerptPageResponse(StrictModel):
    excerpts: list[SourceExcerptResponse] = Field(max_length=LIST_MAX_PAGE_SIZE)
    next_cursor: Cursor | None = None


class ExpectedVersionRequest(StrictModel):
    expected_version: int = Field(ge=1)


class CitationTarget(StrictModel):
    topic_id: UUID | None = None
    quiz_item_id: UUID | None = None
    research_claim_id: UUID | None = None
    note_id: UUID | None = None

    @model_validator(mode="after")
    def exactly_one_target(self) -> "CitationTarget":
        if sum(value is not None for value in self.model_dump().values()) != 1:
            raise ValueError("exactly one typed citation target is required")
        return self

    @property
    def kind(self) -> KnowledgeTargetType:
        if self.topic_id is not None:
            return KnowledgeTargetType.TOPIC
        if self.quiz_item_id is not None:
            return KnowledgeTargetType.QUIZ_ITEM
        if self.research_claim_id is not None:
            return KnowledgeTargetType.RESEARCH_CLAIM
        return KnowledgeTargetType.NOTE


class KnowledgeCitationCreateRequest(StrictModel):
    id: UUID
    excerpt_id: UUID
    target: CitationTarget
    relationship: CitationRelationship
    relation_note: str | None = Field(default=None, max_length=RELATION_NOTE_MAX_SCALARS)

    @field_validator("relation_note")
    @classmethod
    def validate_relation_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_plain_text(
            value,
            field_name="relation_note",
            max_scalars=RELATION_NOTE_MAX_SCALARS,
            max_bytes=RELATION_NOTE_MAX_BYTES,
        )


class KnowledgeCitationReplacementRequest(KnowledgeCitationCreateRequest):
    expected_version: int = Field(ge=1)


class KnowledgeCitationResponse(StrictModel):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    excerpt_id: UUID
    target: CitationTarget
    relationship: CitationRelationship
    relation_note: str | None = Field(default=None, max_length=RELATION_NOTE_MAX_SCALARS)
    accepted_draft_id: UUID | None
    status: KnowledgeLifecycleStatus
    version: int = Field(ge=1)
    created_by: UUID
    created_at: datetime
    updated_at: datetime


class KnowledgeCitationPageResponse(StrictModel):
    citations: list[KnowledgeCitationResponse] = Field(max_length=LIST_MAX_PAGE_SIZE)
    next_cursor: Cursor | None = None


class VersionExpectation(StrictModel):
    target_type: KnowledgeTargetType
    target_id: UUID
    expected_version: int = Field(ge=1)


class ExcerptExpectation(StrictModel):
    excerpt_id: UUID
    expected_version: int = Field(ge=1)
    expected_excerpt_sha256: Sha256Hex
    expected_source_version_key: str = Field(min_length=1, max_length=SOURCE_VERSION_MAX_BYTES)

    @field_validator("expected_source_version_key")
    @classmethod
    def validate_expected_source_version_key(cls, value: str) -> str:
        return _validate_plain_text(
            value,
            field_name="expected_source_version_key",
            max_scalars=SOURCE_VERSION_MAX_BYTES,
            max_bytes=SOURCE_VERSION_MAX_BYTES,
        )


class KnowledgeDraftAcceptanceRequest(StrictModel):
    idempotency_key: UUID
    payload_sha256: Sha256Hex
    expected_draft_version: int = Field(ge=1)
    accepted_candidate_ids: list[UUID] = Field(min_length=1, max_length=100)
    target_expectations: list[VersionExpectation] = Field(max_length=100)
    excerpt_expectations: list[ExcerptExpectation] = Field(max_length=100)
    accepted_edits: dict[DraftFieldName, DraftFieldValue] | None = Field(
        default=None,
        max_length=32,
    )

    @field_validator("accepted_candidate_ids")
    @classmethod
    def candidate_ids_are_unique(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("accepted_candidate_ids must be unique")
        return value

    @field_validator("accepted_edits")
    @classmethod
    def accepted_edit_values_are_bounded(
        cls,
        value: dict[str, str] | None,
    ) -> dict[str, str] | None:
        if value is None:
            return None
        for field_value in value.values():
            _validate_plain_text(
                field_value,
                field_name="accepted_edits value",
                max_scalars=EXCERPT_MAX_SCALARS,
                max_bytes=EXCERPT_MAX_BYTES,
            )
        return value


class KnowledgeDraftAcceptanceReceipt(StrictModel):
    receipt_id: UUID
    idempotency_key: UUID
    draft_id: UUID
    status: Literal["applied"]
    created_object_ids: list[UUID] = Field(max_length=200)
    accepted_at: datetime


class GraphDirection(StrEnum):
    OUT = "out"
    IN = "in"
    BOTH = "both"


class GraphEdgeType(StrEnum):
    TOPIC_DEPENDENCY = "topic_dependency"
    SOURCE = "source"
    DEFINITION = "definition"
    SUPPORT = "support"
    CONTRADICTION = "contradiction"
    EXAMPLE = "example"
    DERIVATION = "derivation"


class GraphTruncationReason(StrEnum):
    NODE_LIMIT = "node_limit"
    EDGE_LIMIT = "edge_limit"
    ROW_LIMIT = "row_limit"
    BYTE_LIMIT = "byte_limit"
    TIME_LIMIT = "time_limit"


class KnowledgeGraphRoot(StrictModel):
    type: KnowledgeTargetType
    id: UUID


class SourceExcerptPreview(StrictModel):
    excerpt_id: UUID
    text: str = Field(max_length=500)
    stale: bool


class KnowledgeGraphNode(KnowledgeGraphRoot):
    label: str = Field(min_length=1, max_length=500)
    version: int = Field(ge=1)
    excerpt_preview: SourceExcerptPreview | None = None


class KnowledgeGraphEdge(StrictModel):
    id: UUID
    type: GraphEdgeType
    source: KnowledgeGraphRoot
    target: KnowledgeGraphRoot
    state: Literal["accepted"] = "accepted"


class KnowledgeGraphLimits(StrictModel):
    nodes: int = Field(default=GRAPH_MAX_NODES, ge=1, le=GRAPH_MAX_NODES)
    edges: int = Field(default=GRAPH_MAX_EDGES, ge=1, le=GRAPH_MAX_EDGES)
    bytes: int = Field(default=GRAPH_MAX_BYTES, ge=1, le=GRAPH_MAX_BYTES)


class KnowledgeGraphResponse(StrictModel):
    root: KnowledgeGraphRoot
    depth: int = Field(ge=1, le=GRAPH_MAX_DEPTH)
    nodes: list[KnowledgeGraphNode] = Field(max_length=GRAPH_MAX_NODES)
    edges: list[KnowledgeGraphEdge] = Field(max_length=GRAPH_MAX_EDGES)
    truncated: bool
    truncation_reasons: list[GraphTruncationReason] = Field(max_length=5)
    next_cursor: Cursor | None = None
    limits: KnowledgeGraphLimits

    @model_validator(mode="after")
    def validate_truncation_shape(self) -> "KnowledgeGraphResponse":
        if self.truncated != bool(self.truncation_reasons):
            raise ValueError("truncated must agree with truncation_reasons")
        if len(set(self.truncation_reasons)) != len(self.truncation_reasons):
            raise ValueError("truncation_reasons must be unique")
        if self.next_cursor is not None and not self.truncated:
            raise ValueError("next_cursor requires a truncated response")
        if len({node.id for node in self.nodes}) != len(self.nodes):
            raise ValueError("graph nodes must be unique by ID")
        if len({edge.id for edge in self.edges}) != len(self.edges):
            raise ValueError("graph edges must be unique by ID")
        return self
