import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from logion_api.sync.push import SyncPushService, canonical_hash
from logion_api.sync.schemas import PushRequest, SyncOperation
from pydantic import ValidationError


def operation_payload() -> dict[str, object]:
    workspace_id = uuid4()
    device_id = uuid4()
    payload = {"name": "Research", "visibility": "private"}
    return {
        "operation_id": uuid4(),
        "protocol_version": "sync-v1",
        "workspace_id": workspace_id,
        "device_id": device_id,
        "entity_type": "space",
        "entity_id": uuid4(),
        "operation_type": "create",
        "base_version": 0,
        "client_occurred_at": datetime.now(UTC),
        "payload": payload,
        "payload_hash": canonical_hash(payload),
        "dependencies": [],
    }


def test_push_dto_matches_authoritative_required_fields() -> None:
    schema_path = (
        Path(__file__).parents[3] / "packages" / "contracts" / "schemas" / "sync-v1.schema.json"
    )
    contract = json.loads(schema_path.read_text(encoding="utf-8"))["$defs"]
    assert set(SyncOperation.model_fields) == set(contract["syncOperation"]["properties"])
    assert {
        name for name, field in SyncOperation.model_fields.items() if field.is_required()
    } == set(contract["syncOperation"]["required"])

    request_fields = {
        "message_type",
        "protocol_version",
        "workspace_id",
        "device_id",
        "sync_epoch",
        "operations",
    }
    assert set(PushRequest.model_fields) == request_fields
    assert {name for name, field in PushRequest.model_fields.items() if field.is_required()} == set(
        contract["pushRequest"]["allOf"][2]["required"]
    )


def test_push_dto_forbids_unknown_fields_and_duplicate_dependencies() -> None:
    operation = operation_payload()
    operation["unknown"] = "rejected"
    with pytest.raises(ValidationError):
        SyncOperation.model_validate(operation)

    operation.pop("unknown")
    dependency = uuid4()
    operation["dependencies"] = [dependency, dependency]
    with pytest.raises(ValidationError):
        SyncOperation.model_validate(operation)


def test_canonical_hash_is_stable_for_key_order_and_unicode() -> None:
    assert canonical_hash({"b": "研究", "a": 1}) == canonical_hash({"a": 1, "b": "研究"})
    assert canonical_hash({"number": 1e-7}) == (
        "sha256:eca50befb60e7b39badf0c1ba912952ed7d996a16e94031801cd0fd4094f1bb8"
    )


def test_push_handlers_are_registered_by_entity_family() -> None:
    dependencies = [object() for _ in range(11)]
    service = SyncPushService(*dependencies)  # type: ignore[arg-type]

    expected_operations = {
        "workspace": {("space", "create")},
        "planning": {("learning_goal", "create")},
        "execution": {
            ("task", "create"),
            ("task", "update"),
            ("study_session", "create"),
            ("study_session", "update"),
        },
        "content": {
            ("note", "create"),
            ("note", "update"),
            ("note_document_update", "update"),
            ("resource", "create"),
            ("resource", "update"),
        },
        "evidence": {("evidence", "create"), ("verification", "update")},
        "memory": {
            ("topic", "create"),
            ("topic_dependency", "create"),
            ("mastery", "create"),
            ("mastery", "update"),
            ("quiz_item", "create"),
            ("quiz_attempt", "create"),
            ("error_pattern", "update"),
            ("audit_review", "create"),
            ("audit_review", "update"),
            ("review_finding", "create"),
            ("review_finding", "update"),
        },
        "exams": {
            ("exam", "create"),
            ("exam_subject", "create"),
            ("syllabus_node", "create"),
            ("mock_exam", "create"),
            ("score_record", "create"),
        },
        "self_study": {
            ("learning_track", "create"),
            ("study_project", "create"),
            ("inbox_item", "create"),
            ("deliverable", "create"),
        },
        "research": {
            ("paper_record", "create"),
            ("research_claim", "create"),
            ("research_question", "create"),
            ("experiment_run", "create"),
            ("metric_record", "create"),
            ("research_feedback", "create"),
        },
        "collaboration": {
            ("rubric", "create"),
            ("group_review", "create"),
            ("group_feedback", "create"),
            ("report_snapshot", "create"),
        },
    }

    assert {
        family: set(handlers) for family, handlers in service._handlers.items()
    } == expected_operations
    assert service._handler_for("task", "create").__name__ == "_create_task"  # type: ignore[union-attr]
    assert service._handler_for("task", "delete") is None
