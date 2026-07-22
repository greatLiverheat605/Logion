from datetime import UTC, datetime
from uuid import uuid4

import pytest
from logion_api.exam.schemas import ExamCreateRequest
from pydantic import ValidationError


def valid_exam(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": uuid4(),
        "title": "User supplied exam",
        "date_status": "scheduled",
        "exam_at": datetime(2026, 9, 5, 1, 0, tzinfo=UTC),
        "timezone": "Asia/Shanghai",
        "target_score": 85,
        "score_scale_max": 100,
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize(
    "overrides",
    [
        {"exam_at": None},
        {"exam_at": datetime(2026, 9, 5, 9, 0)},
        {"timezone": "Not/A_Real_Zone"},
        {"date_status": "undetermined", "exam_at": datetime(2026, 9, 5, 1, 0, tzinfo=UTC)},
        {"target_score": 85, "score_scale_max": None},
        {"target_score": None, "score_scale_max": 100},
        {"target_score": 101, "score_scale_max": 100},
    ],
)
def test_exam_schema_rejects_ambiguous_date_and_score(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ExamCreateRequest.model_validate(valid_exam(**overrides))


def test_exam_schema_accepts_a_date_without_a_target_score() -> None:
    exam = ExamCreateRequest.model_validate(
        valid_exam(target_score=None, score_scale_max=None)
    )
    assert exam.timezone == "Asia/Shanghai"

