from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import and_, or_, select, tuple_

from logion_api.errors import APIError
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.library.routes import Service, require_enabled
from logion_api.memory.models import MasteryRecord, ReviewSchedule, Topic
from logion_api.memory.schemas import MasteryLevel

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/review-queue",
    tags=["research-reading"],
    dependencies=[Depends(require_enabled)],
)


class OnlineReviewItem(BaseModel):
    id: UUID
    topic_id: UUID
    title: str
    kind: Literal["legacy", "reading"]
    confirmed_level: MasteryLevel | None
    next_review_at: datetime


class OnlineReviewPage(BaseModel):
    items: list[OnlineReviewItem]
    next_cursor: str | None


@router.get("", response_model=OnlineReviewPage, operation_id="online_review_queue")
async def review_queue(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    before: AwareDatetime | None = None,
    cursor: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> OnlineReviewPage:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    query = (
        select(ReviewSchedule, Topic, MasteryRecord)
        .join(
            Topic,
            and_(
                Topic.id == ReviewSchedule.topic_id,
                Topic.workspace_id == workspace_id,
                Topic.space_id == space_id,
            ),
        )
        .outerjoin(
            MasteryRecord,
            and_(
                MasteryRecord.topic_id == Topic.id,
                MasteryRecord.user_id == context.user.id,
                MasteryRecord.deleted_at.is_(None),
            ),
        )
        .where(
            ReviewSchedule.workspace_id == workspace_id,
            ReviewSchedule.space_id == space_id,
            ReviewSchedule.user_id == context.user.id,
            ReviewSchedule.deleted_at.is_(None),
            ReviewSchedule.status.in_(("scheduled", "due", "in_progress")),
            Topic.deleted_at.is_(None),
            or_(
                Topic.research_owner_id.is_(None),
                and_(
                    Topic.research_owner_id == context.user.id,
                    MasteryRecord.confirmed_by == context.user.id,
                    MasteryRecord.confirmed_level.is_not(None),
                ),
            ),
        )
    )
    if before is not None:
        query = query.where(ReviewSchedule.next_review_at < before)
    if cursor is not None:
        try:
            raw_time, raw_id = cursor.split("|")
            since, identifier = datetime.fromisoformat(raw_time), UUID(raw_id)
            if since.tzinfo is None:
                raise ValueError
        except ValueError as exc:
            raise APIError(
                code="REVIEW_CURSOR_INVALID", message="Invalid review cursor.", status_code=422
            ) from exc
        query = query.where(
            tuple_(ReviewSchedule.next_review_at, ReviewSchedule.id) > (since, identifier)
        )
    rows = (
        await db.execute(
            query.order_by(ReviewSchedule.next_review_at, ReviewSchedule.id).limit(limit + 1)
        )
    ).all()
    return OnlineReviewPage(
        items=[
            OnlineReviewItem.model_validate(
                {
                    "id": schedule.id,
                    "topic_id": topic.id,
                    "title": topic.title,
                    "kind": "reading" if topic.research_owner_id else "legacy",
                    "confirmed_level": mastery.confirmed_level if mastery else None,
                    "next_review_at": schedule.next_review_at,
                }
            )
            for schedule, topic, mastery in rows[:limit]
        ],
        next_cursor=f"{rows[limit - 1][0].next_review_at.isoformat()}|{rows[limit - 1][0].id}"
        if len(rows) > limit
        else None,
    )
