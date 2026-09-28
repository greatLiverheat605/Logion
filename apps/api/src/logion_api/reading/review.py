from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.library.routes import Service, require_enabled
from logion_api.memory.models import MasteryRecord, QuizItem, ReviewSchedule, Topic
from logion_api.memory.schemas import MasteryLevel

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research",
    tags=["research-reading"],
    dependencies=[Depends(require_enabled)],
)


class ReadingReviewItem(BaseModel):
    id: UUID
    resource_id: UUID
    resource_title: str
    quiz_item_id: UUID
    concept: str
    confirmed_level: MasteryLevel
    next_review_at: datetime


class ReadingReviewPage(BaseModel):
    items: list[ReadingReviewItem]
    next_cursor: UUID | None


@router.get("/review", response_model=ReadingReviewPage, operation_id="reading_review_list")
async def list_reviews(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    cursor: UUID | None = None,
    due_only: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ReadingReviewPage:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    query = (
        select(ReviewSchedule, QuizItem, Topic, Resource, MasteryRecord)
        .join(QuizItem, QuizItem.topic_id == ReviewSchedule.topic_id)
        .join(Topic, Topic.id == QuizItem.topic_id)
        .join(Resource, Resource.id == QuizItem.resource_id)
        .join(
            MasteryRecord,
            (MasteryRecord.topic_id == Topic.id) & (MasteryRecord.user_id == context.user.id),
        )
        .where(
            ReviewSchedule.workspace_id == workspace_id,
            ReviewSchedule.space_id == space_id,
            ReviewSchedule.user_id == context.user.id,
            ReviewSchedule.deleted_at.is_(None),
            ReviewSchedule.status.in_(("scheduled", "due", "in_progress")),
            QuizItem.research_owner_id == context.user.id,
            QuizItem.deleted_at.is_(None),
            Topic.research_owner_id == context.user.id,
            Topic.deleted_at.is_(None),
            Resource.research_owner_id == context.user.id,
            Resource.deleted_at.is_(None),
            MasteryRecord.deleted_at.is_(None),
            MasteryRecord.confirmed_by == context.user.id,
            MasteryRecord.confirmed_level.is_not(None),
        )
    )
    if cursor is not None:
        query = query.where(ReviewSchedule.id > cursor)
    if due_only:
        query = query.where(ReviewSchedule.next_review_at <= utc_now())
    rows = (await db.execute(query.order_by(ReviewSchedule.id).limit(limit + 1))).all()
    return ReadingReviewPage(
        items=[
            ReadingReviewItem.model_validate(
                {
                    "id": schedule.id,
                    "resource_id": resource.id,
                    "resource_title": resource.title,
                    "quiz_item_id": item.id,
                    "concept": topic.title,
                    "confirmed_level": mastery.confirmed_level,
                    "next_review_at": schedule.next_review_at,
                }
            )
            for schedule, item, topic, resource, mastery in rows[:limit]
        ],
        next_cursor=rows[limit - 1][0].id if len(rows) > limit else None,
    )
