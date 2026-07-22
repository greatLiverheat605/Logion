from datetime import datetime
from uuid import uuid4

import pytest
from logion_api.self_study.schemas import DeliverableCreateRequest, ProjectCreateRequest
from pydantic import ValidationError


def test_self_study_schema_rejects_empty_outcome_and_naive_completion() -> None:
    with pytest.raises(ValidationError):
        ProjectCreateRequest(id=uuid4(), track_id=uuid4(), title="Project", intended_outcome=" ")
    with pytest.raises(ValidationError):
        DeliverableCreateRequest(
            id=uuid4(),
            project_id=uuid4(),
            title="Result",
            evidence_summary="evidence",
            completed_at=datetime(2026, 7, 22, 12, 0),
        )
