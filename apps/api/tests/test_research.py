from datetime import datetime
from uuid import uuid4

import pytest
from logion_api.research.schemas import MetricCreate, RunCreate
from pydantic import ValidationError


def test_research_schema_rejects_naive_run_and_non_finite_metric() -> None:
    with pytest.raises(ValidationError):
        RunCreate(
            id=uuid4(),
            question_id=uuid4(),
            title="Run",
            method_summary="method",
            completed_at=datetime(2026, 7, 22, 12, 0),
        )
    with pytest.raises(ValidationError):
        MetricCreate(id=uuid4(), run_id=uuid4(), name="metric", value=float("inf"))
