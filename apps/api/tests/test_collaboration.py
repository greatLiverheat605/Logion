from datetime import datetime
from uuid import uuid4

import pytest
from logion_api.collaboration.schemas import (
    CollaborationFeedbackCreate,
    CollaborationReportCreate,
    CollaborationRubricCreate,
)
from pydantic import ValidationError


def test_collaboration_schema_rejects_naive_time_and_blank_content() -> None:
    with pytest.raises(ValidationError):
        CollaborationReportCreate(
            id=uuid4(),
            review_id=uuid4(),
            summary="report",
            published_at=datetime(2026, 7, 22, 12, 0),
        )
    with pytest.raises(ValidationError):
        CollaborationRubricCreate(id=uuid4(), title="rubric", criteria="   ")
    with pytest.raises(ValidationError):
        CollaborationFeedbackCreate(id=uuid4(), review_id=uuid4(), feedback="   ")
