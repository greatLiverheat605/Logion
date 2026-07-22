from datetime import UTC, datetime
from uuid import uuid4

import pytest
from logion_api.exam.schemas import (
    ExamCreateRequest,
    MockExamCreateRequest,
    ScoreRecordCreateRequest,
    SubjectCreateRequest,
    SyllabusNodeCreateRequest,
)
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
    exam = ExamCreateRequest.model_validate(valid_exam(target_score=None, score_scale_max=None))
    assert exam.timezone == "Asia/Shanghai"


def test_subject_and_syllabus_schemas_bound_user_structure() -> None:
    with pytest.raises(ValidationError):
        SubjectCreateRequest(id=uuid4(), exam_id=uuid4(), name="Subject", weight_basis_points=10001)
    shared_id = uuid4()
    with pytest.raises(ValidationError):
        SyllabusNodeCreateRequest(
            id=shared_id,
            subject_id=uuid4(),
            parent_id=shared_id,
            title="Node",
            importance=3,
        )
    with pytest.raises(ValidationError):
        SyllabusNodeCreateRequest(id=uuid4(), subject_id=uuid4(), title="Node", importance=6)


def test_mock_and_score_schemas_reject_invalid_attempts() -> None:
    with pytest.raises(ValidationError):
        MockExamCreateRequest(id=uuid4(), exam_id=uuid4(), title="Mock", duration_limit_seconds=59)
    with pytest.raises(ValidationError):
        ScoreRecordCreateRequest(
            id=uuid4(),
            mock_exam_id=uuid4(),
            score=101,
            score_scale_max=100,
            duration_seconds=3600,
            completed_at=datetime.now(UTC),
        )
    with pytest.raises(ValidationError):
        ScoreRecordCreateRequest(
            id=uuid4(),
            mock_exam_id=uuid4(),
            score=80,
            score_scale_max=100,
            duration_seconds=3600,
            completed_at=datetime(2026, 9, 5, 9, 0),
        )
