from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PortableModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


type WorkbenchRef = Annotated[
    str,
    StringConstraints(
        pattern=(
            r"^(fixed\.(learning|research|exam|mentor)|"
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
            r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
        ),
        min_length=13,
        max_length=36,
    ),
]
type NameText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type DescriptionText = Annotated[str, StringConstraints(max_length=280)]
type StableItemId = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,63}$", max_length=64)
]
type JsonScalar = str | int | float | bool | None
type SafeInteger = Annotated[int, Field(ge=-9007199254740991, le=9007199254740991)]
type Revision = Annotated[int, Field(ge=1, le=9007199254740991)]
type AttributeKey = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_.-]{0,63}$", max_length=64)
]
type FixedWorkbenchId = Literal[
    "fixed.learning",
    "fixed.research",
    "fixed.exam",
    "fixed.mentor",
]
type WorkbenchTargetKind = Literal[
    "task",
    "source",
    "topic",
    "note",
    "evidence",
    "claim",
    "project",
]


class WorkbenchDefaultSpace(PortableModel):
    workspace_id: UUID
    space_id: UUID


class WorkbenchPreferencePayloadV1(PortableModel):
    active_workbench_id: WorkbenchRef
    hidden_fixed_workbench_ids: list[FixedWorkbenchId] = Field(
        max_length=3,
        json_schema_extra={"uniqueItems": True},
    )
    workbench_order: list[WorkbenchRef] = Field(
        max_length=24,
        json_schema_extra={"uniqueItems": True},
    )
    density: Literal["compact", "comfortable"]
    default_view_by_workbench: dict[WorkbenchRef, StableItemId] = Field(max_length=24)
    default_space_by_workbench: dict[WorkbenchRef, WorkbenchDefaultSpace] = Field(max_length=24)


class WorkbenchPreferenceDocumentV1(PortableModel):
    contract: Literal["workbench.preference"]
    schema_version: Literal[1]
    revision: Revision
    payload: WorkbenchPreferencePayloadV1


class WorkbenchModule(PortableModel):
    id: StableItemId
    kind: Literal[
        "next-action",
        "task-queue",
        "projects",
        "sources",
        "topics",
        "review",
        "evidence",
        "timeline",
        "graph-projection",
        "saved-view",
        "recent-objects",
        "pinned-objects",
    ]
    title: NameText | None = None
    filter_ids: list[StableItemId] = Field(
        default_factory=list,
        max_length=32,
        json_schema_extra={"uniqueItems": True},
    )
    quick_create_ids: list[StableItemId] = Field(
        default_factory=list,
        max_length=16,
        json_schema_extra={"uniqueItems": True},
    )


class WorkbenchLayoutItem(PortableModel):
    module_id: StableItemId
    region: Literal["main", "side", "footer"]
    order: Annotated[int, Field(ge=0, le=63)]
    span: Annotated[int, Field(ge=1, le=4)]


class WorkbenchLayout(PortableModel):
    columns: Annotated[int, Field(ge=1, le=4)]
    items: list[WorkbenchLayoutItem] = Field(max_length=64)


class WorkbenchTargetBase(PortableModel):
    id: UUID


class TaskTarget(WorkbenchTargetBase):
    kind: Literal["task"]


class SourceTarget(WorkbenchTargetBase):
    kind: Literal["source"]


class TopicTarget(WorkbenchTargetBase):
    kind: Literal["topic"]


class NoteTarget(WorkbenchTargetBase):
    kind: Literal["note"]


class EvidenceTarget(WorkbenchTargetBase):
    kind: Literal["evidence"]


class ClaimTarget(WorkbenchTargetBase):
    kind: Literal["claim"]


class ProjectTarget(WorkbenchTargetBase):
    kind: Literal["project"]


type WorkbenchTargetV1 = Annotated[
    TaskTarget
    | SourceTarget
    | TopicTarget
    | NoteTarget
    | EvidenceTarget
    | ClaimTarget
    | ProjectTarget,
    Field(discriminator="kind"),
]


class WorkbenchFilterBase(PortableModel):
    id: StableItemId


class TargetKindInFilter(WorkbenchFilterBase):
    kind: Literal["target-kind-in"]
    target_kinds: list[WorkbenchTargetKind] = Field(
        min_length=1,
        max_length=7,
        json_schema_extra={"uniqueItems": True},
    )


class TaskStatusInFilter(WorkbenchFilterBase):
    kind: Literal["task-status-in"]
    statuses: list[
        Literal[
            "backlog",
            "planned",
            "in_progress",
            "submitted",
            "verified",
            "done",
            "blocked",
            "cancelled",
        ]
    ] = Field(min_length=1, max_length=8, json_schema_extra={"uniqueItems": True})


class UpdatedWithinDaysFilter(WorkbenchFilterBase):
    kind: Literal["updated-within-days"]
    days: Annotated[int, Field(ge=1, le=365)]


class AttributeEqualsFilter(WorkbenchFilterBase):
    kind: Literal["attribute-equals"]
    field_id: StableItemId
    value: JsonScalar | list[StableItemId] | WorkbenchTargetV1


type WorkbenchFilter = Annotated[
    TargetKindInFilter | TaskStatusInFilter | UpdatedWithinDaysFilter | AttributeEqualsFilter,
    Field(discriminator="kind"),
]


class WorkbenchQuickCreate(PortableModel):
    id: StableItemId
    command: Literal["task.create", "note.create", "source.create", "topic.create"]


class WorkbenchFieldOption(PortableModel):
    id: StableItemId
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class WorkbenchFieldBase(PortableModel):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,47}$", max_length=48)]
    label: NameText
    required: bool = False


class TextFieldDefinition(WorkbenchFieldBase):
    type: Literal["text"]
    max_length: Annotated[int, Field(ge=1, le=2000)]


class NumberFieldDefinition(WorkbenchFieldBase):
    type: Literal["number"]
    minimum: SafeInteger | float
    maximum: SafeInteger | float


class DateFieldDefinition(WorkbenchFieldBase):
    type: Literal["date"]


class SingleSelectFieldDefinition(WorkbenchFieldBase):
    type: Literal["single-select"]
    options: list[WorkbenchFieldOption] = Field(min_length=1, max_length=32)


class MultiSelectFieldDefinition(WorkbenchFieldBase):
    type: Literal["multi-select"]
    options: list[WorkbenchFieldOption] = Field(min_length=1, max_length=32)
    max_selections: Annotated[int, Field(ge=1, le=32)]


class BooleanFieldDefinition(WorkbenchFieldBase):
    type: Literal["boolean"]


class UrlFieldDefinition(WorkbenchFieldBase):
    type: Literal["url"]


class RatingFieldDefinition(WorkbenchFieldBase):
    type: Literal["rating"]
    minimum: Annotated[int, Field(ge=0, le=9)]
    maximum: Annotated[int, Field(ge=1, le=10)]


class ObjectReferenceFieldDefinition(WorkbenchFieldBase):
    type: Literal["object-reference"]
    allowed_target_kinds: list[WorkbenchTargetKind] = Field(
        min_length=1,
        max_length=7,
        json_schema_extra={"uniqueItems": True},
    )


type WorkbenchFieldDefinition = Annotated[
    TextFieldDefinition
    | NumberFieldDefinition
    | DateFieldDefinition
    | SingleSelectFieldDefinition
    | MultiSelectFieldDefinition
    | BooleanFieldDefinition
    | UrlFieldDefinition
    | RatingFieldDefinition
    | ObjectReferenceFieldDefinition,
    Field(discriminator="type"),
]


class WorkbenchDefinitionPayloadV1(PortableModel):
    name: NameText
    description: DescriptionText
    icon: Literal[
        "book-open",
        "microscope",
        "graduation-cap",
        "users",
        "layout-dashboard",
        "target",
        "folder",
        "note",
    ]
    accent: Literal["neutral", "blue", "green", "amber", "red", "violet", "cyan"]
    template_id: FixedWorkbenchId | Literal["blank"]
    modules: list[WorkbenchModule] = Field(max_length=24)
    layout: WorkbenchLayout
    filters: list[WorkbenchFilter] = Field(max_length=32)
    quick_create: list[WorkbenchQuickCreate] = Field(max_length=16)
    field_definitions: list[WorkbenchFieldDefinition] = Field(max_length=32)


class WorkbenchDefinitionDocumentV1(PortableModel):
    contract: Literal["workbench.definition"]
    schema_version: Literal[1]
    payload: WorkbenchDefinitionPayloadV1


class WorkbenchDefinitionCreateRequest(PortableModel):
    document: WorkbenchDefinitionDocumentV1


class WorkbenchDefinitionReplaceRequest(PortableModel):
    expected_revision: Revision
    base: WorkbenchDefinitionDocumentV1
    local: WorkbenchDefinitionDocumentV1


class WorkbenchDefinitionLifecycleRequest(PortableModel):
    expected_revision: Revision
    base_lifecycle: Literal["active", "archived"]


class WorkbenchDefinitionSummary(PortableModel):
    id: UUID
    owner_user_id: UUID
    name: str
    description: str
    icon: str
    accent: str
    template_id: str
    revision: Revision
    lifecycle: Literal["active", "archived"]
    created_at: datetime
    updated_at: datetime


class WorkbenchDefinitionResponse(WorkbenchDefinitionSummary):
    document: WorkbenchDefinitionDocumentV1


class WorkbenchDefinitionPageResponse(PortableModel):
    items: list[WorkbenchDefinitionSummary]
    next_cursor: str | None = None


class WorkbenchDefinitionDeletionImpact(PortableModel):
    workbench_id: UUID
    revision: Revision
    link_set_revision: Revision
    link_count: Annotated[int, Field(ge=0, le=500)]
    preference_will_fallback: bool
    fallback_workbench_id: Literal["fixed.learning"]
    formal_object_delete_count: Literal[0]
    impact_fingerprint: Annotated[str, StringConstraints(max_length=1024)]


class WorkbenchDefinitionDeleteRequest(PortableModel):
    expected_revision: Revision
    expected_link_set_revision: Revision
    impact_fingerprint: Annotated[str, StringConstraints(max_length=1024)]


class WorkbenchDefinitionDeleteReceipt(PortableModel):
    receipt_id: UUID
    deleted_definition_id: UUID
    deleted_link_count: Annotated[int, Field(ge=0, le=500)]
    preference_fallback: bool
    deleted_at: datetime


class WorkbenchLinkMutableV1(PortableModel):
    target: WorkbenchTargetV1
    position: Annotated[int, Field(ge=0, le=499)]
    primary_context: bool = False
    attributes: dict[AttributeKey, JsonScalar | list[StableItemId] | WorkbenchTargetV1] = Field(
        default_factory=dict,
        max_length=32,
    )


class WorkbenchLinkCreateRequest(PortableModel):
    base_link_set_revision: Revision
    local: WorkbenchLinkMutableV1


class WorkbenchLinkPatchRequest(PortableModel):
    expected_revision: Revision
    base_link_set_revision: Revision
    base: WorkbenchLinkMutableV1
    local: WorkbenchLinkMutableV1


class WorkbenchLinkDeleteRequest(PortableModel):
    expected_revision: Revision
    base_link_set_revision: Revision
    base: WorkbenchLinkMutableV1


class WorkbenchLinkReorderRequest(PortableModel):
    base_link_set_revision: Revision
    base_order: list[UUID] = Field(max_length=500)
    ordered_link_ids: list[UUID] = Field(max_length=500)


class WorkbenchObjectLinkResponse(PortableModel):
    id: UUID
    workbench_id: UUID
    owner_user_id: UUID
    revision: Revision
    link_set_revision: Revision
    created_at: datetime
    updated_at: datetime
    mutable: WorkbenchLinkMutableV1


class WorkbenchLinkPageResponse(PortableModel):
    items: list[WorkbenchObjectLinkResponse]
    next_cursor: str | None = None


class WorkbenchLinkDeleteReceipt(PortableModel):
    link_id: UUID
    link_set_revision: Revision
    deleted_at: datetime


class WorkbenchLinkSetResponse(PortableModel):
    link_set_revision: Revision
    ordered_link_ids: list[UUID]


class WorkbenchExportV1(PortableModel):
    contract: Literal["workbench.export"]
    schema_version: Literal[1]
    document: WorkbenchDefinitionDocumentV1
    links: list[WorkbenchLinkMutableV1] | None = None


class WorkbenchImportRequest(PortableModel):
    source_fingerprint: Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
    payload: WorkbenchExportV1


class WorkbenchSkippedLinks(PortableModel):
    count: Annotated[int, Field(ge=0, le=500)]
    reason: Literal["not_available"]


class WorkbenchImportReceipt(PortableModel):
    receipt_id: UUID
    operation: Literal["workbench.import.v1"]
    idempotency_key: UUID
    source_fingerprint: Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
    created_at: datetime
    skipped_links: WorkbenchSkippedLinks | None = None


class WorkbenchImportSucceededReceipt(WorkbenchImportReceipt):
    status: Literal["succeeded"]
    retryable: Literal[False] = False
    definition_id: UUID


class WorkbenchImportFailedReceipt(WorkbenchImportReceipt):
    status: Literal["failed"]
    retryable: Literal[False] = False
    definition_id: Literal[None] = None


class WorkbenchValidationIssue(StrictModel):
    path: list[str] = Field(max_length=32)
    rule: Annotated[str, StringConstraints(min_length=1, max_length=256)]


class WorkbenchErrorDetails(StrictModel):
    issues: list[WorkbenchValidationIssue] = Field(default_factory=list, max_length=32)


class WorkbenchEmptyDetails(StrictModel):
    pass


class WorkbenchImportRetryableErrorResponse(StrictModel):
    code: str
    message: str
    details: WorkbenchEmptyDetails
    retryable: Literal[True]
    request_id: str


class WorkbenchConflictDetails(StrictModel):
    entity: Literal["definition", "link", "link_set"]
    base_revision: Revision
    remote_revision: Revision
    conflict_paths: list[Annotated[str, StringConstraints(max_length=256)]] = Field(max_length=128)
    base: WorkbenchDefinitionDocumentV1 | WorkbenchLinkMutableV1
    local: WorkbenchDefinitionDocumentV1 | WorkbenchLinkMutableV1
    remote: WorkbenchDefinitionDocumentV1 | WorkbenchLinkMutableV1


class WorkbenchPreconditionInvalidErrorResponse(StrictModel):
    code: Literal["WORKBENCH_PRECONDITION_INVALID"]
    message: str
    details: WorkbenchEmptyDetails = Field(default_factory=WorkbenchEmptyDetails)
    retryable: Literal[False] = False
    request_id: str


class WorkbenchForbiddenErrorResponse(StrictModel):
    code: Literal["WORKBENCH_OPERATION_DENIED"]
    message: str
    details: WorkbenchEmptyDetails = Field(default_factory=WorkbenchEmptyDetails)
    retryable: Literal[False] = False
    request_id: str


class WorkbenchNotFoundErrorResponse(StrictModel):
    code: Literal["RESOURCE_NOT_FOUND"]
    message: str
    details: WorkbenchEmptyDetails = Field(default_factory=WorkbenchEmptyDetails)
    retryable: Literal[False] = False
    request_id: str


class WorkbenchConflictErrorResponse(StrictModel):
    code: Literal["WORKBENCH_VERSION_CONFLICT", "WORKBENCH_IDEMPOTENCY_CONFLICT"]
    message: str
    details: WorkbenchConflictDetails | WorkbenchEmptyDetails = Field(
        default_factory=WorkbenchEmptyDetails
    )
    retryable: Literal[False] = False
    request_id: str


class WorkbenchValidationErrorResponse(StrictModel):
    code: Literal["WORKBENCH_PREFERENCE_INVALID", "WORKBENCH_SCHEMA_INVALID"]
    message: str
    details: WorkbenchErrorDetails = Field(default_factory=WorkbenchErrorDetails)
    retryable: Literal[False] = False
    request_id: str


class WorkbenchRateLimitedErrorResponse(StrictModel):
    code: Literal["WORKBENCH_RATE_LIMITED"]
    message: str
    details: WorkbenchEmptyDetails = Field(default_factory=WorkbenchEmptyDetails)
    retryable: Literal[True] = True
    request_id: str
