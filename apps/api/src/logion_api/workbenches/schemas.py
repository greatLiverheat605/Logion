from __future__ import annotations

import ipaddress
import math
import re
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit
from uuid import UUID

import rfc8785
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    RootModel,
    Strict,
    StringConstraints,
    WithJsonSchema,
    model_validator,
)
from pydantic.alias_generators import to_camel


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PortableModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


def _plain_text(value: str, *, max_bytes: int) -> str:
    if _has_control(value):
        raise ValueError("control characters are not allowed")
    if len(value.encode("utf-8")) > max_bytes:
        raise ValueError("UTF-8 byte length is too large")
    return value


def _has_control(value: str) -> bool:
    return any(ord(character) < 32 or 127 <= ord(character) <= 159 for character in value)


def _reject_controls(value: object) -> object:
    if isinstance(value, str) and _has_control(value):
        raise ValueError("control characters are not allowed")
    return value


def _name_text(value: str) -> str:
    return _plain_text(value, max_bytes=320)


def _description_text(value: str) -> str:
    return _plain_text(value, max_bytes=1120)


def _unique(values: list[object], label: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"{label} must be unique")


def _strict_integer(value: object) -> int:
    if type(value) is not int:
        raise ValueError("value must be a JSON integer")
    return value


def _schema_version_one(value: object) -> int:
    value = _strict_integer(value)
    if value != 1:
        raise ValueError("schemaVersion must be 1")
    return value


def _strict_float(value: object) -> float:
    if not isinstance(value, float):
        raise ValueError("value must be a JSON number with a fraction")
    return value


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
    str,
    BeforeValidator(_reject_controls, json_schema_input_type=str),
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    AfterValidator(_name_text),
    WithJsonSchema({"type": "string", "minLength": 1, "maxLength": 80}, mode="serialization"),
]
type DescriptionText = Annotated[
    str,
    StringConstraints(max_length=280),
    AfterValidator(_description_text),
]
type StableItemId = Annotated[
    str, StringConstraints(pattern=r"^[a-z][a-z0-9_-]{0,63}$", max_length=64)
]
type SafeInteger = Annotated[
    int,
    Strict(),
    Field(ge=-9007199254740991, le=9007199254740991),
]
type StrictFiniteFloat = Annotated[
    float,
    BeforeValidator(_strict_float, json_schema_input_type=float),
    Field(allow_inf_nan=False),
]
type JsonScalar = str | SafeInteger | StrictFiniteFloat | bool | None
type Revision = Annotated[int, Strict(), Field(ge=1, le=9007199254740991)]
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

    @model_validator(mode="after")
    def validate_workbench_lists(self) -> WorkbenchPreferencePayloadV1:
        _unique(list(self.hidden_fixed_workbench_ids), "hiddenFixedWorkbenchIds")
        _unique(list(self.workbench_order), "workbenchOrder")
        if "fixed.learning" in self.hidden_fixed_workbench_ids:
            raise ValueError("fixed.learning cannot be hidden")
        if "fixed.learning" not in self.workbench_order:
            raise ValueError("workbenchOrder must include fixed.learning")
        return self


class WorkbenchPreferenceDocumentV1(PortableModel):
    contract: Literal["workbench.preference"]
    schema_version: Annotated[
        Literal[1], BeforeValidator(_schema_version_one, json_schema_input_type=Literal[1])
    ]
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
    order: Annotated[int, Strict(), Field(ge=0, le=63)]
    span: Annotated[int, Strict(), Field(ge=1, le=4)]


class WorkbenchLayout(PortableModel):
    columns: Annotated[int, Strict(), Field(ge=1, le=4)]
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
    days: Annotated[int, Strict(), Field(ge=1, le=365)]


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
    label: NameText


class WorkbenchFieldBase(PortableModel):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,47}$", max_length=48)]
    label: NameText
    required: Annotated[bool, Strict()] = False


class TextFieldDefinition(WorkbenchFieldBase):
    type: Literal["text"]
    max_length: Annotated[int, Strict(), Field(ge=1, le=2000)]


class NumberFieldDefinition(WorkbenchFieldBase):
    type: Literal["number"]
    minimum: SafeInteger | StrictFiniteFloat
    maximum: SafeInteger | StrictFiniteFloat


class DateFieldDefinition(WorkbenchFieldBase):
    type: Literal["date"]


class SingleSelectFieldDefinition(WorkbenchFieldBase):
    type: Literal["single-select"]
    options: list[WorkbenchFieldOption] = Field(min_length=1, max_length=32)


class MultiSelectFieldDefinition(WorkbenchFieldBase):
    type: Literal["multi-select"]
    options: list[WorkbenchFieldOption] = Field(min_length=1, max_length=32)
    max_selections: Annotated[int, Strict(), Field(ge=1, le=32)]


class BooleanFieldDefinition(WorkbenchFieldBase):
    type: Literal["boolean"]


class UrlFieldDefinition(WorkbenchFieldBase):
    type: Literal["url"]


class RatingFieldDefinition(WorkbenchFieldBase):
    type: Literal["rating"]
    minimum: Annotated[int, Strict(), Field(ge=0, le=9)]
    maximum: Annotated[int, Strict(), Field(ge=1, le=10)]


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


_DNS_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_IPV4_NUMBER = re.compile(r"^(?:[0-9]+|0x[0-9a-f]*)$")


def _validate_http_url(value: str) -> None:
    _plain_text(value, max_bytes=2048)
    if "\\" in value or any(character.isspace() or ord(character) < 32 for character in value):
        raise ValueError("URL contains a forbidden character")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise ValueError("URL is invalid") from error
    if not value.startswith(("http://", "https://")) or not parsed.netloc:
        raise ValueError("URL must be absolute HTTP or HTTPS")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError("URL credentials and fragments are not allowed")
    if parsed.netloc.endswith(":") or port == 0:
        raise ValueError("URL port is invalid")
    host = parsed.hostname
    if host is None or not host.isascii() or parsed.netloc != parsed.netloc.lower() or "%" in host:
        raise ValueError("URL hostname is invalid")
    canonical_authority = f"[{host}]" if ":" in host else host
    if port is not None:
        canonical_authority += f":{port}"
    if parsed.netloc != canonical_authority:
        raise ValueError("URL authority is not canonical")
    if ":" in host:
        if not parsed.netloc.startswith("[") or str(ipaddress.IPv6Address(host)) != host:
            raise ValueError("URL IPv6 hostname is not canonical")
        return
    try:
        address = ipaddress.IPv4Address(host)
    except ipaddress.AddressValueError:
        if (
            len(host) > 253
            or host.endswith(".")
            or all(_IPV4_NUMBER.fullmatch(label) for label in host.split("."))
            or any(not _DNS_LABEL.fullmatch(label) for label in host.split("."))
        ):
            raise ValueError("URL DNS hostname is invalid") from None
    else:
        if str(address) != host:
            raise ValueError("URL IPv4 hostname is not canonical")


def _validate_field_definition(field: WorkbenchFieldDefinition) -> None:
    if isinstance(field, NumberFieldDefinition):
        if not math.isfinite(field.minimum) or not math.isfinite(field.maximum):
            raise ValueError("number field bounds must be finite")
        if field.minimum > field.maximum:
            raise ValueError("number field minimum must not exceed maximum")
    if isinstance(field, (SingleSelectFieldDefinition, MultiSelectFieldDefinition)):
        _unique([option.id for option in field.options], "field option ids")
    if isinstance(field, RatingFieldDefinition) and field.minimum >= field.maximum:
        raise ValueError("rating field minimum must be less than maximum")


def _validate_filter_value(
    filter_value: AttributeEqualsFilter,
    field: WorkbenchFieldDefinition,
) -> None:
    value = filter_value.value
    if isinstance(field, TextFieldDefinition):
        if not isinstance(value, str) or len(value) > field.max_length:
            raise ValueError("text filter value does not match its field")
        _plain_text(value, max_bytes=2048)
    elif isinstance(field, NumberFieldDefinition):
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < field.minimum
            or value > field.maximum
        ):
            raise ValueError("number filter value does not match its field")
    elif isinstance(field, DateFieldDefinition):
        if not isinstance(value, str):
            raise ValueError("date filter value does not match its field")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise ValueError("date filter value does not match its field") from error
        if parsed.isoformat() != value:
            raise ValueError("date filter value must use ISO format")
    elif isinstance(field, (SingleSelectFieldDefinition, MultiSelectFieldDefinition)):
        allowed = {option.id for option in field.options}
        values = value if isinstance(value, list) else [value]
        if (
            (isinstance(field, SingleSelectFieldDefinition) and isinstance(value, list))
            or (isinstance(field, MultiSelectFieldDefinition) and not isinstance(value, list))
            or any(not isinstance(item, str) or item not in allowed for item in values)
        ):
            raise ValueError("select filter value does not match its field")
        _unique(list(values), "multi-select filter values")
        if isinstance(field, MultiSelectFieldDefinition) and len(values) > field.max_selections:
            raise ValueError("multi-select filter value exceeds maxSelections")
    elif isinstance(field, BooleanFieldDefinition):
        if type(value) is not bool:
            raise ValueError("boolean filter value does not match its field")
    elif isinstance(field, UrlFieldDefinition):
        if not isinstance(value, str):
            raise ValueError("URL filter value does not match its field")
        _validate_http_url(value)
    elif isinstance(field, RatingFieldDefinition):
        if type(value) is not int or not field.minimum <= value <= field.maximum:
            raise ValueError("rating filter value does not match its field")
    elif isinstance(field, ObjectReferenceFieldDefinition):
        if (
            not isinstance(value, WorkbenchTargetBase)
            or value.kind not in field.allowed_target_kinds
        ):
            raise ValueError("object-reference filter value does not match its field")


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

    @model_validator(mode="after")
    def validate_references(self) -> WorkbenchDefinitionPayloadV1:
        module_ids = [module.id for module in self.modules]
        filter_ids = [item.id for item in self.filters]
        quick_create_ids = [item.id for item in self.quick_create]
        field_ids = [field.id for field in self.field_definitions]
        for values, label in (
            (module_ids, "module ids"),
            (filter_ids, "filter ids"),
            (quick_create_ids, "quick-create ids"),
            (field_ids, "field ids"),
        ):
            _unique(list(values), label)

        filter_id_set = set(filter_ids)
        quick_create_id_set = set(quick_create_ids)
        for module in self.modules:
            _unique(list(module.filter_ids), "module filterIds")
            _unique(list(module.quick_create_ids), "module quickCreateIds")
            if not set(module.filter_ids) <= filter_id_set:
                raise ValueError("module filterIds must reference existing filters")
            if not set(module.quick_create_ids) <= quick_create_id_set:
                raise ValueError("module quickCreateIds must reference existing quick creates")

        layout_module_ids = [item.module_id for item in self.layout.items]
        _unique(list(layout_module_ids), "layout moduleIds")
        if set(layout_module_ids) != set(module_ids):
            raise ValueError("layout must contain every module exactly once")
        _unique([(item.region, item.order) for item in self.layout.items], "layout region orders")
        if any(item.span > self.layout.columns for item in self.layout.items):
            raise ValueError("layout span must not exceed columns")

        fields = {field.id: field for field in self.field_definitions}
        for field in self.field_definitions:
            _validate_field_definition(field)
        for filter_value in self.filters:
            if isinstance(filter_value, TargetKindInFilter):
                _unique(list(filter_value.target_kinds), "filter targetKinds")
            elif isinstance(filter_value, TaskStatusInFilter):
                _unique(list(filter_value.statuses), "filter statuses")
            elif isinstance(filter_value, AttributeEqualsFilter):
                referenced_field = fields.get(filter_value.field_id)
                if referenced_field is None:
                    raise ValueError("attribute-equals fieldId must reference an existing field")
                _validate_filter_value(filter_value, referenced_field)
        for field in self.field_definitions:
            if isinstance(field, ObjectReferenceFieldDefinition):
                _unique(list(field.allowed_target_kinds), "allowedTargetKinds")
        return self


class WorkbenchDefinitionDocumentV1(PortableModel):
    contract: Literal["workbench.definition"]
    schema_version: Annotated[
        Literal[1], BeforeValidator(_schema_version_one, json_schema_input_type=Literal[1])
    ]
    payload: WorkbenchDefinitionPayloadV1

    @model_validator(mode="after")
    def validate_canonical_size(self) -> WorkbenchDefinitionDocumentV1:
        try:
            size = len(rfc8785.dumps(self.model_dump(mode="json", by_alias=True)))
        except (TypeError, ValueError) as error:
            raise ValueError("Definition contains a non-canonical JSON value") from error
        if size > 32 * 1024:
            raise ValueError("Definition exceeds 32 KiB canonical JSON")
        return self


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
    link_count: Annotated[int, Strict(), Field(ge=0, le=500)]
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
    deleted_link_count: Annotated[int, Strict(), Field(ge=0, le=500)]
    preference_fallback: bool
    deleted_at: datetime


class WorkbenchLinkMutableV1(PortableModel):
    target: WorkbenchTargetV1
    position: Annotated[int, Strict(), Field(ge=0, le=499)]
    primary_context: Annotated[bool, Strict()] = False
    attributes: dict[AttributeKey, JsonScalar | list[StableItemId] | WorkbenchTargetV1] = Field(
        default_factory=dict,
        max_length=32,
    )

    @model_validator(mode="after")
    def validate_canonical_size(self) -> WorkbenchLinkMutableV1:
        try:
            size = len(rfc8785.dumps(self.model_dump(mode="json", by_alias=True)))
        except (TypeError, ValueError) as error:
            raise ValueError("Link contains a non-canonical JSON value") from error
        if size > 2 * 1024:
            raise ValueError("Link exceeds 2 KiB canonical JSON")
        return self


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
    schema_version: Annotated[
        Literal[1], BeforeValidator(_schema_version_one, json_schema_input_type=Literal[1])
    ]
    document: WorkbenchDefinitionDocumentV1
    links: list[WorkbenchLinkMutableV1] | None = None


class WorkbenchImportRequest(PortableModel):
    source_fingerprint: Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]
    payload: WorkbenchExportV1


class WorkbenchSkippedLinks(PortableModel):
    count: Annotated[int, Strict(), Field(ge=0, le=500)]
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


class WorkbenchConflictDetailsBase(PortableModel):
    base_revision: Revision
    remote_revision: Revision
    conflict_paths: list[Annotated[str, StringConstraints(max_length=256)]] = Field(
        max_length=128,
        json_schema_extra={"uniqueItems": True},
    )

    @model_validator(mode="after")
    def validate_conflict_paths(self) -> WorkbenchConflictDetailsBase:
        _unique(list(self.conflict_paths), "conflict paths")
        return self


class WorkbenchDefinitionConflictDetails(WorkbenchConflictDetailsBase):
    entity: Literal["definition"]
    base: WorkbenchDefinitionDocumentV1
    local: WorkbenchDefinitionDocumentV1
    remote: WorkbenchDefinitionDocumentV1


class WorkbenchLinkConflictDetails(WorkbenchConflictDetailsBase):
    entity: Literal["link"]
    base: WorkbenchLinkMutableV1
    local: WorkbenchLinkMutableV1
    remote: WorkbenchLinkMutableV1


class WorkbenchLinkSetConflictDetails(WorkbenchConflictDetailsBase):
    entity: Literal["link_set"]
    base: list[UUID] = Field(max_length=500, json_schema_extra={"uniqueItems": True})
    local: list[UUID] = Field(max_length=500, json_schema_extra={"uniqueItems": True})
    remote: list[UUID] = Field(max_length=500, json_schema_extra={"uniqueItems": True})

    @model_validator(mode="after")
    def validate_orders(self) -> WorkbenchLinkSetConflictDetails:
        for order, label in ((self.base, "base"), (self.local, "local"), (self.remote, "remote")):
            _unique(list(order), f"{label} link ids")
        return self


class WorkbenchConflictDetails(
    RootModel[
        Annotated[
            WorkbenchDefinitionConflictDetails
            | WorkbenchLinkConflictDetails
            | WorkbenchLinkSetConflictDetails,
            Field(discriminator="entity"),
        ]
    ]
):
    pass


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


class WorkbenchConflictErrorResponseBase(StrictModel):
    message: str
    retryable: Literal[False]
    request_id: str


class WorkbenchVersionConflictErrorResponse(WorkbenchConflictErrorResponseBase):
    code: Literal["WORKBENCH_VERSION_CONFLICT"]
    details: WorkbenchConflictDetails | WorkbenchEmptyDetails


class WorkbenchIdempotencyConflictErrorResponse(WorkbenchConflictErrorResponseBase):
    code: Literal["WORKBENCH_IDEMPOTENCY_CONFLICT"]
    details: WorkbenchEmptyDetails


class WorkbenchConflictErrorResponse(
    RootModel[
        Annotated[
            WorkbenchVersionConflictErrorResponse | WorkbenchIdempotencyConflictErrorResponse,
            Field(discriminator="code"),
        ]
    ]
):
    pass


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
