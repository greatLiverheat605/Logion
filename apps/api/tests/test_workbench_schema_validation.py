from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

import pytest
import rfc8785
from logion_api.workbenches.schemas import (
    NumberFieldDefinition,
    UpdatedWithinDaysFilter,
    WorkbenchConflictDetails,
    WorkbenchConflictErrorResponse,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionPayloadV1,
    WorkbenchLayout,
    WorkbenchLinkMutableV1,
    WorkbenchPreferencePayloadV1,
)
from pydantic import ValidationError


def _document() -> dict[str, Any]:
    return {
        "contract": "workbench.definition",
        "schemaVersion": 1,
        "payload": {
            "name": "Research desk",
            "description": "",
            "icon": "microscope",
            "accent": "cyan",
            "templateId": "fixed.research",
            "modules": [
                {
                    "id": "queue",
                    "kind": "task-queue",
                    "filterIds": ["open"],
                    "quickCreateIds": ["new_task"],
                }
            ],
            "layout": {
                "columns": 2,
                "items": [{"moduleId": "queue", "region": "main", "order": 0, "span": 2}],
            },
            "filters": [
                {
                    "id": "open",
                    "kind": "attribute-equals",
                    "fieldId": "status",
                    "value": "ready",
                }
            ],
            "quickCreate": [{"id": "new_task", "command": "task.create"}],
            "fieldDefinitions": [
                {
                    "id": "status",
                    "label": "Status",
                    "type": "single-select",
                    "options": [{"id": "ready", "label": "Ready"}],
                }
            ],
        },
    }


def _sized_document(target_size: int) -> dict[str, Any]:
    document = _document()
    payload = document["payload"]
    payload["modules"] = []
    payload["layout"] = {"columns": 1, "items": []}
    payload["filters"] = []
    payload["quickCreate"] = []
    payload["fieldDefinitions"] = [
        {
            "id": f"field_{field_index}",
            "label": "Field",
            "type": "single-select",
            "options": [
                {"id": f"option-{option_index}", "label": "x"} for option_index in range(32)
            ],
        }
        for field_index in range(10)
    ]
    remaining = target_size - _normalized_document_size(document)
    assert 0 <= remaining <= 10 * 32 * 79
    for field in payload["fieldDefinitions"]:
        for option in field["options"]:
            added = min(79, remaining)
            option["label"] += "x" * added
            remaining -= added
    assert remaining == 0
    assert _normalized_document_size(document) == target_size
    return document


def _normalized_document_size(document: dict[str, Any]) -> int:
    payload = WorkbenchDefinitionPayloadV1.model_validate(document["payload"])
    normalized = {
        "contract": document["contract"],
        "schemaVersion": document["schemaVersion"],
        "payload": payload.model_dump(mode="json", by_alias=True),
    }
    return len(rfc8785.dumps(normalized))


def _conflict_document(name: str) -> dict[str, Any]:
    document = _document()
    document["payload"]["name"] = name
    return document


def test_valid_definition_and_exact_canonical_size_boundary() -> None:
    assert WorkbenchDefinitionDocumentV1.model_validate(_document()).payload.name == "Research desk"
    exact = WorkbenchDefinitionDocumentV1.model_validate(_sized_document(32 * 1024))
    assert len(rfc8785.dumps(exact.model_dump(mode="json", by_alias=True))) == 32 * 1024

    with pytest.raises(ValidationError, match="exceeds 32 KiB"):
        WorkbenchDefinitionDocumentV1.model_validate(_sized_document(32 * 1024 + 1))


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value["payload"]["modules"].append({"id": "queue", "kind": "sources"}),
        lambda value: value["payload"]["filters"].append(
            {"id": "open", "kind": "updated-within-days", "days": 7}
        ),
        lambda value: value["payload"]["quickCreate"].append(
            {"id": "new_task", "command": "note.create"}
        ),
        lambda value: value["payload"]["fieldDefinitions"].append(
            {"id": "status", "label": "Other", "type": "boolean"}
        ),
        lambda value: value["payload"]["modules"][0].update({"filterIds": ["missing"]}),
        lambda value: value["payload"]["modules"][0].update({"quickCreateIds": ["missing"]}),
        lambda value: value["payload"]["layout"]["items"].clear(),
        lambda value: value["payload"]["layout"]["items"][0].update({"span": 3}),
        lambda value: value["payload"]["filters"][0].update({"fieldId": "missing"}),
        lambda value: value["payload"]["fieldDefinitions"][0]["options"].append(
            {"id": "ready", "label": "Duplicate"}
        ),
    ],
)
def test_definition_rejects_duplicate_or_dangling_structure(mutate: Any) -> None:
    document = _document()
    mutate(document)
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(document)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ({"id": "score", "label": "Score", "type": "number", "minimum": 2, "maximum": 1}, 1),
        ({"id": "score", "label": "Score", "type": "rating", "minimum": 5, "maximum": 5}, 5),
        ({"id": "flag", "label": "Flag", "type": "boolean"}, "true"),
        ({"id": "due", "label": "Due", "type": "date"}, "20260820"),
        ({"id": "site", "label": "Site", "type": "url"}, "https://user@example.com"),
        (
            {
                "id": "target",
                "label": "Target",
                "type": "object-reference",
                "allowedTargetKinds": ["task"],
            },
            {"kind": "note", "id": str(uuid4())},
        ),
    ],
)
def test_attribute_filter_value_must_match_registered_field(
    field: dict[str, Any], value: object
) -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [field]
    document["payload"]["filters"][0].update({"fieldId": field["id"], "value": value})
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(document)


@pytest.mark.parametrize(
    "url",
    [
        "HTTPS://example.com",
        "https://EXAMPLE.com",
        "https://127.0.0.01",
        "https://2130706433",
        "https://0x/",
        "https://0x.0/",
        "https://0x.0x/",
        "https://0x7f000001/path",
        "https://0x7f.0.0.1/path",
        "https://0x7f.1/path",
        "https://127.0x0.0.1/path",
        "https://0xffffffff/path",
        "https://example.com./path",
        "https://exa%6dple.com",
        "https://例子.example",
        "https://example.com/#fragment",
    ],
)
def test_url_filter_rejects_noncanonical_or_credential_like_hosts(url: str) -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [{"id": "site", "label": "Site", "type": "url"}]
    document["payload"]["filters"][0].update({"fieldId": "site", "value": url})
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(document)


def test_url_filter_accepts_canonical_http_url_without_fetching() -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [{"id": "site", "label": "Site", "type": "url"}]
    document["payload"]["filters"][0].update(
        {"fieldId": "site", "value": "https://example.com:443/path?q=1"}
    )
    WorkbenchDefinitionDocumentV1.model_validate(document)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com:00001/path",
        "https://example.com:00080/path",
        "https://[::1]:00001/path",
    ],
)
def test_url_filter_rejects_noncanonical_explicit_ports(url: str) -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [{"id": "site", "label": "Site", "type": "url"}]
    document["payload"]["filters"][0].update({"fieldId": "site", "value": url})
    with pytest.raises(ValidationError, match="authority is not canonical"):
        WorkbenchDefinitionDocumentV1.model_validate(document)


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:1/path",
        "https://[::1]:65535/path",
        "https://123.example/path",
        "https://0xresearch.example/path",
    ],
)
def test_url_filter_accepts_canonical_ip_and_port_authorities(url: str) -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [{"id": "site", "label": "Site", "type": "url"}]
    document["payload"]["filters"][0].update({"fieldId": "site", "value": url})
    WorkbenchDefinitionDocumentV1.model_validate(document)


def test_plain_text_rejects_controls_and_utf8_byte_overflow() -> None:
    document = _document()
    document["payload"]["name"] = "line\nbreak"
    with pytest.raises(ValidationError, match="control characters"):
        WorkbenchDefinitionDocumentV1.model_validate(document)

    document = _document()
    document["payload"]["name"] = "\nTrimmed control"
    with pytest.raises(ValidationError, match="control characters"):
        WorkbenchDefinitionDocumentV1.model_validate(document)

    document = _document()
    document["payload"]["name"] = "😀" * 80 + "x"
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(document)


def test_plain_text_exact_unicode_and_utf8_boundaries() -> None:
    document = _document()
    document["payload"]["name"] = "😀" * 80
    document["payload"]["description"] = "😀" * 280
    document["payload"]["fieldDefinitions"][0]["options"][0]["label"] = "😀" * 80
    WorkbenchDefinitionDocumentV1.model_validate(document)

    for path in ("name", "description"):
        oversized = deepcopy(document)
        oversized["payload"][path] += "x"
        with pytest.raises(ValidationError):
            WorkbenchDefinitionDocumentV1.model_validate(oversized)

    oversized = deepcopy(document)
    oversized["payload"]["fieldDefinitions"][0]["options"][0]["label"] += "x"
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(oversized)


@pytest.mark.parametrize("codepoint", [0x7F, 0x80, 0x9F])
def test_url_filter_rejects_c0_and_c1_controls(codepoint: int) -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [{"id": "site", "label": "Site", "type": "url"}]
    document["payload"]["filters"][0].update(
        {"fieldId": "site", "value": f"https://example.com/{chr(codepoint)}x"}
    )
    with pytest.raises(ValidationError, match="control characters"):
        WorkbenchDefinitionDocumentV1.model_validate(document)


@pytest.mark.parametrize(
    ("model", "value"),
    [
        (WorkbenchLayout, {"columns": True, "items": []}),
        (
            NumberFieldDefinition,
            {"id": "score", "label": "Score", "type": "number", "minimum": True, "maximum": 2},
        ),
        (
            UpdatedWithinDaysFilter,
            {"id": "recent", "kind": "updated-within-days", "days": 1.0},
        ),
    ],
)
def test_integer_fields_reject_boolean_and_float_coercion(model: Any, value: object) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(value)


def test_client_boolean_fields_reject_integer_coercion() -> None:
    document = _document()
    document["payload"]["fieldDefinitions"] = [
        {"id": "flag", "label": "Flag", "type": "boolean", "required": 1}
    ]
    with pytest.raises(ValidationError):
        WorkbenchDefinitionDocumentV1.model_validate(document)

    link = {
        "target": {"kind": "task", "id": str(uuid4())},
        "position": 0,
        "primaryContext": 1,
        "attributes": {},
    }
    with pytest.raises(ValidationError):
        WorkbenchLinkMutableV1.model_validate(link)


@pytest.mark.parametrize("value", [-(2**53), 2**53, 2**53 + 1, 10**100])
def test_json_number_unions_reject_unsafe_integer_fallback(value: int) -> None:
    link = {
        "target": {"kind": "task", "id": str(uuid4())},
        "position": 0,
        "attributes": {"score": value},
    }
    with pytest.raises(ValidationError):
        WorkbenchLinkMutableV1.model_validate(link)

    with pytest.raises(ValidationError):
        NumberFieldDefinition.model_validate(
            {"id": "score", "label": "Score", "type": "number", "minimum": value, "maximum": 1.5}
        )


@pytest.mark.parametrize("value", [-(2**53 - 1), 2**53 - 1, 1.5])
def test_json_number_unions_accept_safe_integers_and_real_floats(value: int | float) -> None:
    link = {
        "target": {"kind": "task", "id": str(uuid4())},
        "position": 0,
        "attributes": {"score": value},
    }
    WorkbenchLinkMutableV1.model_validate(link)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(hiddenFixedWorkbenchIds=["fixed.exam", "fixed.exam"]),
        lambda value: value.update(workbenchOrder=["fixed.learning", "fixed.learning"]),
        lambda value: value.update(hiddenFixedWorkbenchIds=["fixed.learning"]),
        lambda value: value.update(workbenchOrder=["fixed.exam"]),
    ],
)
def test_preference_lists_enforce_runtime_invariants(mutate: Any) -> None:
    preference = {
        "activeWorkbenchId": "fixed.learning",
        "hiddenFixedWorkbenchIds": [],
        "workbenchOrder": ["fixed.learning"],
        "density": "compact",
        "defaultViewByWorkbench": {},
        "defaultSpaceByWorkbench": {},
    }
    mutate(preference)
    with pytest.raises(ValidationError):
        WorkbenchPreferencePayloadV1.model_validate(preference)


def test_schema_version_rejects_boolean_coercion() -> None:
    document = _document()
    document["schemaVersion"] = True
    with pytest.raises(ValidationError, match="JSON integer"):
        WorkbenchDefinitionDocumentV1.model_validate(document)


def test_link_exact_canonical_size_boundary() -> None:
    link: dict[str, Any] = {
        "target": {"kind": "task", "id": str(uuid4())},
        "position": 0,
        "primaryContext": False,
        "attributes": {"note": ""},
    }
    base_size = len(rfc8785.dumps(link))
    link["attributes"]["note"] = "x" * (2 * 1024 - base_size)
    assert len(rfc8785.dumps(link)) == 2 * 1024
    WorkbenchLinkMutableV1.model_validate(link)

    link["attributes"]["note"] += "x"
    with pytest.raises(ValidationError, match="exceeds 2 KiB"):
        WorkbenchLinkMutableV1.model_validate(link)


def test_conflict_details_are_camel_case_and_paths_are_unique() -> None:
    details = WorkbenchConflictDetails.model_validate(
        {
            "entity": "definition",
            "baseRevision": 1,
            "remoteRevision": 2,
            "conflictPaths": ["payload.name"],
            "base": _conflict_document("Base"),
            "local": _conflict_document("Local"),
            "remote": _conflict_document("Remote"),
        }
    )
    assert set(details.model_dump(mode="json", by_alias=True)) == {
        "entity",
        "baseRevision",
        "remoteRevision",
        "conflictPaths",
        "base",
        "local",
        "remote",
    }
    schema = WorkbenchConflictDetails.model_json_schema(by_alias=True)
    assert schema["discriminator"]["propertyName"] == "entity"
    assert len(schema["oneOf"]) == 3

    duplicate = details.model_dump(mode="json", by_alias=True)
    duplicate["conflictPaths"] = ["payload.name", "payload.name"]
    with pytest.raises(ValidationError, match="must be unique"):
        WorkbenchConflictDetails.model_validate(duplicate)


def test_conflict_details_bind_entity_to_three_way_value_type() -> None:
    definition = _conflict_document("Definition")
    link = {
        "target": {"kind": "task", "id": str(uuid4())},
        "position": 0,
        "attributes": {},
    }
    mixed = {
        "entity": "definition",
        "baseRevision": 1,
        "remoteRevision": 2,
        "conflictPaths": [],
        "base": definition,
        "local": link,
        "remote": definition,
    }
    with pytest.raises(ValidationError):
        WorkbenchConflictDetails.model_validate(mixed)

    first, second = uuid4(), uuid4()
    link_set = {
        "entity": "link_set",
        "baseRevision": 1,
        "remoteRevision": 2,
        "conflictPaths": ["orderedLinkIds"],
        "base": [first, second],
        "local": [second, first],
        "remote": [first, second],
    }
    details = WorkbenchConflictDetails.model_validate(link_set)
    assert details.model_dump(mode="json", by_alias=True)["local"] == [str(second), str(first)]

    link_set["remote"] = [first, first]
    with pytest.raises(ValidationError, match="must be unique"):
        WorkbenchConflictDetails.model_validate(link_set)


def test_lifecycle_version_conflict_uses_empty_details() -> None:
    response = WorkbenchConflictErrorResponse.model_validate(
        {
            "code": "WORKBENCH_VERSION_CONFLICT",
            "message": "The Workbench changed after it was read.",
            "details": {},
            "retryable": False,
            "request_id": "request-id",
        }
    )
    assert response.root.details.model_dump() == {}


def test_idempotency_conflict_rejects_three_way_details() -> None:
    details = {
        "entity": "definition",
        "baseRevision": 1,
        "remoteRevision": 2,
        "conflictPaths": [],
        "base": _conflict_document("Base"),
        "local": _conflict_document("Local"),
        "remote": _conflict_document("Remote"),
    }
    with pytest.raises(ValidationError):
        WorkbenchConflictErrorResponse.model_validate(
            {
                "code": "WORKBENCH_IDEMPOTENCY_CONFLICT",
                "message": "The idempotency key was already used.",
                "details": details,
                "retryable": False,
                "request_id": "request-id",
            }
        )

    response = WorkbenchConflictErrorResponse.model_validate(
        {
            "code": "WORKBENCH_IDEMPOTENCY_CONFLICT",
            "message": "The idempotency key was already used.",
            "details": {},
            "retryable": False,
            "request_id": "request-id",
        }
    )
    assert response.model_dump(mode="json") == {
        "code": "WORKBENCH_IDEMPOTENCY_CONFLICT",
        "message": "The idempotency key was already used.",
        "details": {},
        "retryable": False,
        "request_id": "request-id",
    }


def test_validation_does_not_mutate_input() -> None:
    document = _document()
    snapshot = deepcopy(document)
    WorkbenchDefinitionDocumentV1.model_validate(document)
    assert document == snapshot
