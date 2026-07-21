from datetime import UTC, datetime
from uuid import uuid4

import pytest
from logion_api.execution.schemas import TaskCreateRequest, TaskTransitionRequest
from logion_api.execution.service import TRANSITIONS
from pydantic import ValidationError


def task_payload() -> dict[str, object]:
    return {
        "id": uuid4(),
        "goal_id": uuid4(),
        "title": "Read and summarize a paper",
        "description": "Produce a short note with citations.",
        "planned_at": datetime(2026, 7, 22, 9, tzinfo=UTC),
        "due_at": datetime(2026, 7, 22, 11, tzinfo=UTC),
    }


def test_task_create_request_is_strict_and_requires_aware_dates() -> None:
    payload = task_payload()
    payload["unknown"] = True
    with pytest.raises(ValidationError):
        TaskCreateRequest.model_validate(payload)

    payload.pop("unknown")
    payload["planned_at"] = datetime(2026, 7, 22, 9)
    with pytest.raises(ValidationError, match="timezone"):
        TaskCreateRequest.model_validate(payload)


def test_task_create_request_rejects_due_date_before_start() -> None:
    payload = task_payload()
    payload["due_at"] = datetime(2026, 7, 22, 8, tzinfo=UTC)
    with pytest.raises(ValidationError, match="due_at"):
        TaskCreateRequest.model_validate(payload)


def test_task_transition_contract_and_evidence_gate() -> None:
    assert TRANSITIONS["backlog"] == frozenset({"planned", "cancelled"})
    assert "verified" not in set().union(*TRANSITIONS.values())
    assert "done" not in set().union(*TRANSITIONS.values())
    assert TRANSITIONS["submitted"] == frozenset({"in_progress"})

    parsed = TaskTransitionRequest.model_validate(
        {"expected_version": 1, "status": "blocked", "blocked_reason": "Waiting for data"}
    )
    assert parsed.blocked_reason == "Waiting for data"
    with pytest.raises(ValidationError, match="requires a reason"):
        TaskTransitionRequest.model_validate({"expected_version": 1, "status": "blocked"})
    with pytest.raises(ValidationError):
        TaskTransitionRequest.model_validate(
            {"expected_version": 1, "status": "verified", "unexpected": True}
        )
