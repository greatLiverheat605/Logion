"""Keep private research assessments out of legacy sync and shared projections."""

from typing import Any, cast

from sqlalchemy import select, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from logion_api.memory.models import (
    ErrorPattern,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewSchedule,
    Topic,
)

DERIVED_RESEARCH_MODELS = (MasteryRecord, ReviewSchedule, QuizAttempt, ErrorPattern)


def legacy_memory_scope(model: Any) -> ColumnElement[bool]:
    if model in (Topic, QuizItem):
        return cast(ColumnElement[bool], model.research_owner_id.is_(None))
    if model in DERIVED_RESEARCH_MODELS:
        return cast(
            ColumnElement[bool],
            model.topic_id.in_(select(Topic.id).where(Topic.research_owner_id.is_(None))),
        )
    return true()


async def is_private_memory_record(db: AsyncSession, record: Any) -> bool:
    if isinstance(record, (Topic, QuizItem)):
        return record.research_owner_id is not None
    if isinstance(record, DERIVED_RESEARCH_MODELS):
        return (
            await db.scalar(select(Topic.research_owner_id).where(Topic.id == record.topic_id))
        ) is not None
    return False
