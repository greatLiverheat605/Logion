from uuid import uuid4

import pytest
from logion_api.memory.schemas import MasteryConfirmRequest, TopicDependencyCreateRequest
from logion_api.memory.service import REVIEW_INTERVAL_DAYS
from pydantic import ValidationError


def test_mastery_intervals_are_bounded_and_monotonic() -> None:
    assert REVIEW_INTERVAL_DAYS == {
        "unknown": 1,
        "exposed": 1,
        "practicing": 2,
        "familiar": 4,
        "proficient": 7,
        "mastered": 14,
    }
    assert max(REVIEW_INTERVAL_DAYS.values()) <= 3650


def test_memory_schemas_reject_self_links_alias_ids_and_unknown_levels() -> None:
    topic_id = uuid4()
    with pytest.raises(ValidationError):
        TopicDependencyCreateRequest(
            id=uuid4(),
            prerequisite_topic_id=topic_id,
            dependent_topic_id=topic_id,
        )
    record_id = uuid4()
    with pytest.raises(ValidationError):
        MasteryConfirmRequest(
            mastery_id=record_id,
            schedule_id=record_id,
            expected_version=0,
            confirmed_level="mastered",
        )
    with pytest.raises(ValidationError):
        MasteryConfirmRequest(
            mastery_id=uuid4(),
            schedule_id=uuid4(),
            expected_version=0,
            confirmed_level="perfect",
        )
