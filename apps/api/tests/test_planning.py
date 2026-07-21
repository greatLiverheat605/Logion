from uuid import uuid4

import pytest
from logion_api.planning.schemas import GoalPlanCreateRequest
from pydantic import ValidationError


def valid_payload() -> dict[str, object]:
    return {
        "goal_id": uuid4(),
        "plan_id": uuid4(),
        "plan_version_id": uuid4(),
        "title": "Learn a new subject",
        "description": "A user-defined context",
        "desired_outcome": "Produce a verifiable result",
        "weekly_minutes": 360,
        "target_date": None,
        "phases": [
            {
                "id": uuid4(),
                "title": "Foundation",
                "description": "",
                "position": 0,
                "estimated_minutes": 600,
                "acceptance_criteria": ["Complete the foundation assessment"],
            }
        ],
    }


def test_planning_request_is_strict_and_positions_are_contiguous() -> None:
    payload = valid_payload()
    payload["unknown"] = True
    with pytest.raises(ValidationError):
        GoalPlanCreateRequest.model_validate(payload)

    payload.pop("unknown")
    phases = payload["phases"]
    assert isinstance(phases, list)
    assert isinstance(phases[0], dict)
    phases[0]["position"] = 1
    with pytest.raises(ValidationError):
        GoalPlanCreateRequest.model_validate(payload)


def test_planning_request_rejects_reused_client_ids() -> None:
    payload = valid_payload()
    payload["plan_id"] = payload["goal_id"]
    with pytest.raises(ValidationError):
        GoalPlanCreateRequest.model_validate(payload)
