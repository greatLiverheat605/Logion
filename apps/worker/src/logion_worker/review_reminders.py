"""Daily in-app review digests; no email or push delivery."""

from datetime import UTC, datetime
from time import monotonic
from uuid import UUID
from zoneinfo import ZoneInfo

from logion_api.db import session_factory
from logion_api.engagement.models import NotificationPreference
from logion_api.engagement.service import EngagementService
from logion_api.identity.models import User
from logion_api.memory.models import ReviewSchedule, Topic
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession


def in_quiet_time(preference: NotificationPreference | None, now: datetime) -> bool:
    if preference is None:
        return False
    start, end = preference.quiet_start_minute, preference.quiet_end_minute
    if start is None or end is None or start == end:
        return False
    local = now.astimezone(ZoneInfo(preference.timezone))
    minute = local.hour * 60 + local.minute
    return start <= minute < end if start < end else minute >= start or minute < end


async def emit_due_review_reminders(
    db: AsyncSession,
    now: datetime,
    after: tuple[UUID, UUID] | None = None,
) -> list[tuple[UUID, UUID]]:
    # Keyset batches keep disabled/quiet recipients from starving later users.
    query = (
        select(ReviewSchedule.workspace_id, ReviewSchedule.user_id, func.count())
        .join(Topic, Topic.id == ReviewSchedule.topic_id)
        .join(Space, Space.id == ReviewSchedule.space_id)
        .join(Workspace, Workspace.id == ReviewSchedule.workspace_id)
        .join(User, User.id == ReviewSchedule.user_id)
        .join(
            WorkspaceMembership,
            (WorkspaceMembership.workspace_id == ReviewSchedule.workspace_id)
            & (WorkspaceMembership.user_id == ReviewSchedule.user_id),
        )
        .where(
            ReviewSchedule.next_review_at <= now,
            ReviewSchedule.status.in_(("scheduled", "due")),
            ReviewSchedule.deleted_at.is_(None),
            Topic.deleted_at.is_(None),
            Space.status == "active",
            Workspace.status == "active",
            User.status == "active",
            WorkspaceMembership.status == "active",
            or_(Space.visibility == "shared", Space.owner_user_id == ReviewSchedule.user_id),
        )
        .group_by(ReviewSchedule.workspace_id, ReviewSchedule.user_id)
        .order_by(ReviewSchedule.workspace_id, ReviewSchedule.user_id)
        .limit(100)
    )
    if after is not None:
        query = query.where(tuple_(ReviewSchedule.workspace_id, ReviewSchedule.user_id) > after)
    rows = (await db.execute(query)).all()
    for workspace_id, user_id, count in rows:
        preference = await db.get(NotificationPreference, (workspace_id, user_id))
        if in_quiet_time(preference, now):
            continue
        local_day = now.astimezone(ZoneInfo(preference.timezone if preference else "UTC")).date()
        await EngagementService.emit(
            db,
            workspace_id=workspace_id,
            recipient_user_id=user_id,
            category="learning",
            title="今日有到期复习",
            summary=f"当前有 {count} 个知识点到期，请打开复习页查看最新安排。每天最多提醒一次。",
            dedupe_key=f"review:due:{local_day.isoformat()}",
            target_type="review",
        )
    return [(workspace_id, user_id) for workspace_id, user_id, _count in rows]


class ReviewReminderService:
    def __init__(self) -> None:
        self._next_poll = 0.0
        self._after: tuple[UUID, UUID] | None = None

    async def execute_next(self) -> bool:
        if monotonic() < self._next_poll:
            return False
        async with session_factory() as db:
            recipients = await emit_due_review_reminders(db, datetime.now(UTC), self._after)
            await db.commit()
        self._after = recipients[-1] if len(recipients) == 100 else None
        self._next_poll = monotonic() + 60
        return False
