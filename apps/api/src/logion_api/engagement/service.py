import secrets
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.db import utc_now
from logion_api.engagement.models import (
    CalendarFeed,
    Notification,
    NotificationCategory,
    NotificationPreference,
)
from logion_api.engagement.schemas import (
    CalendarFeedCreate,
    NotificationPreferenceUpdate,
    SearchRequest,
    SearchResult,
    SearchType,
)
from logion_api.errors import APIError
from logion_api.exam.models import Exam
from logion_api.execution.models import Task
from logion_api.identity.audit import new_audit_event
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext
from logion_api.memory.models import ReviewSchedule, Topic
from logion_api.planning.models import LearningGoal
from logion_api.research.models import PaperRecord
from logion_api.workspaces.models import Space, WorkspaceMembership
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

ALL_CATEGORIES = ["learning", "collaboration", "sync", "security", "ai", "billing", "system"]


class EngagementService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces
        self._security = IdentitySecurity(settings.secret_key.get_secret_value())

    async def search(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: SearchRequest,
        request_id: str,
    ) -> list[SearchResult]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        spaces = list(
            (
                await db.scalars(
                    select(Space).where(
                        Space.workspace_id == workspace_id,
                        Space.status == "active",
                        or_(
                            Space.visibility == "shared",
                            Space.owner_user_id == context.user.id,
                        ),
                    )
                )
            ).all()
        )
        space_by_id = {space.id: space for space in spaces}
        space_ids = list(space_by_id)
        if not space_ids:
            return []
        escaped = self._escape_like(payload.query)
        pattern = f"%{escaped}%"
        results: list[SearchResult] = []
        per_type_limit = payload.limit
        if "goal" in payload.object_types:
            goal_rows = list(
                (
                    await db.scalars(
                        select(LearningGoal)
                        .where(
                            LearningGoal.workspace_id == workspace_id,
                            LearningGoal.space_id.in_(space_ids),
                            LearningGoal.deleted_at.is_(None),
                            or_(
                                LearningGoal.title.ilike(pattern, escape="\\"),
                                LearningGoal.description.ilike(pattern, escape="\\"),
                                LearningGoal.desired_outcome.ilike(pattern, escape="\\"),
                            ),
                        )
                        .order_by(LearningGoal.updated_at.desc())
                        .limit(per_type_limit)
                    )
                ).all()
            )
            results.extend(
                self._result(
                    "goal",
                    row.id,
                    workspace_id,
                    row.space_id,
                    row.title,
                    f"{row.description} {row.desired_outcome}",
                    row.updated_at,
                    space_by_id[row.space_id],
                    payload.query,
                )
                for row in goal_rows
            )
        if "task" in payload.object_types:
            task_rows = list(
                (
                    await db.scalars(
                        select(Task)
                        .where(
                            Task.workspace_id == workspace_id,
                            Task.space_id.in_(space_ids),
                            Task.deleted_at.is_(None),
                            or_(
                                Task.title.ilike(pattern, escape="\\"),
                                Task.description.ilike(pattern, escape="\\"),
                            ),
                        )
                        .order_by(Task.updated_at.desc())
                        .limit(per_type_limit)
                    )
                ).all()
            )
            results.extend(
                self._result(
                    "task",
                    row.id,
                    workspace_id,
                    row.space_id,
                    row.title,
                    row.description,
                    row.updated_at,
                    space_by_id[row.space_id],
                    payload.query,
                )
                for row in task_rows
            )
        if "note" in payload.object_types:
            note_rows = list(
                (
                    await db.scalars(
                        select(Note)
                        .where(
                            Note.workspace_id == workspace_id,
                            Note.space_id.in_(space_ids),
                            Note.deleted_at.is_(None),
                            or_(
                                Note.title.ilike(pattern, escape="\\"),
                                Note.markdown_body.ilike(pattern, escape="\\"),
                            ),
                        )
                        .order_by(Note.updated_at.desc())
                        .limit(per_type_limit)
                    )
                ).all()
            )
            results.extend(
                self._result(
                    "note",
                    row.id,
                    workspace_id,
                    row.space_id,
                    row.title,
                    row.markdown_body,
                    row.updated_at,
                    space_by_id[row.space_id],
                    payload.query,
                )
                for row in note_rows
            )
        if "resource" in payload.object_types:
            resource_rows = list(
                (
                    await db.scalars(
                        select(Resource)
                        .where(
                            Resource.workspace_id == workspace_id,
                            Resource.space_id.in_(space_ids),
                            Resource.deleted_at.is_(None),
                            or_(
                                Resource.title.ilike(pattern, escape="\\"),
                                Resource.pdf_filename.ilike(pattern, escape="\\"),
                            ),
                        )
                        .order_by(Resource.updated_at.desc())
                        .limit(per_type_limit)
                    )
                ).all()
            )
            results.extend(
                self._result(
                    "resource",
                    row.id,
                    workspace_id,
                    row.space_id,
                    row.title,
                    row.pdf_filename or "",
                    row.updated_at,
                    space_by_id[row.space_id],
                    payload.query,
                )
                for row in resource_rows
            )
        if "paper" in payload.object_types:
            paper_rows = list(
                (
                    await db.scalars(
                        select(PaperRecord)
                        .where(
                            PaperRecord.workspace_id == workspace_id,
                            PaperRecord.space_id.in_(space_ids),
                            PaperRecord.user_id == context.user.id,
                            PaperRecord.deleted_at.is_(None),
                            or_(
                                PaperRecord.title.ilike(pattern, escape="\\"),
                                PaperRecord.citation_key.ilike(pattern, escape="\\"),
                            ),
                        )
                        .order_by(PaperRecord.updated_at.desc())
                        .limit(per_type_limit)
                    )
                ).all()
            )
            results.extend(
                SearchResult(
                    object_type="paper",
                    object_id=row.id,
                    workspace_id=workspace_id,
                    space_id=row.space_id,
                    title=row.title,
                    snippet=self._snippet(row.citation_key, payload.query),
                    permission_source="personal_record",
                    updated_at=row.updated_at,
                )
                for row in paper_rows
            )
        return sorted(results, key=lambda row: row.updated_at, reverse=True)[: payload.limit]

    async def get_preferences(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> NotificationPreference | None:
        await self._authorize(db, context, workspace_id, request_id)
        return await db.get(NotificationPreference, (workspace_id, context.user.id))

    async def update_preferences(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: NotificationPreferenceUpdate,
        request_id: str,
    ) -> NotificationPreference:
        await self._authorize(db, context, workspace_id, request_id)
        try:
            ZoneInfo(payload.timezone)
        except ZoneInfoNotFoundError as exc:
            raise APIError(
                code="TIMEZONE_INVALID",
                message="The notification timezone is invalid.",
                status_code=422,
            ) from exc
        row = await db.scalar(
            select(NotificationPreference)
            .where(
                NotificationPreference.workspace_id == workspace_id,
                NotificationPreference.user_id == context.user.id,
            )
            .with_for_update()
        )
        if row is None:
            if payload.expected_version is not None:
                raise self._conflict("Notification preferences do not exist.")
            row = NotificationPreference(
                workspace_id=workspace_id,
                user_id=context.user.id,
                enabled_categories=payload.enabled_categories,
                timezone=payload.timezone,
                quiet_start_minute=payload.quiet_start_minute,
                quiet_end_minute=payload.quiet_end_minute,
            )
            db.add(row)
        else:
            if row.version != payload.expected_version:
                raise self._conflict("Notification preferences changed.")
            row.enabled_categories = payload.enabled_categories
            row.timezone = payload.timezone
            row.quiet_start_minute = payload.quiet_start_minute
            row.quiet_end_minute = payload.quiet_end_minute
            row.version += 1
            row.updated_at = utc_now()
        await db.flush()
        return row

    async def list_notifications(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[Notification]:
        await self._authorize(db, context, workspace_id, request_id)
        return list(
            (
                await db.scalars(
                    select(Notification)
                    .where(
                        Notification.workspace_id == workspace_id,
                        Notification.recipient_user_id == context.user.id,
                    )
                    .order_by(Notification.created_at.desc(), Notification.id.desc())
                    .limit(200)
                )
            ).all()
        )

    async def mark_read(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        notification_id: UUID,
        request_id: str,
    ) -> Notification:
        await self._authorize(db, context, workspace_id, request_id)
        row = await db.scalar(
            select(Notification)
            .where(
                Notification.id == notification_id,
                Notification.workspace_id == workspace_id,
                Notification.recipient_user_id == context.user.id,
            )
            .with_for_update()
        )
        if row is None:
            raise self._not_found("Notification")
        row.read_at = row.read_at or utc_now()
        await db.flush()
        return row

    async def create_feed(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: CalendarFeedCreate,
        request_id: str,
    ) -> tuple[CalendarFeed, str]:
        await self._authorize(db, context, workspace_id, request_id)
        existing = await db.get(CalendarFeed, payload.id)
        if existing is not None and existing.workspace_id != workspace_id:
            raise self._not_found("Calendar feed")
        if existing is not None:
            raise self._conflict("Calendar feed identifier exists.")
        token = secrets.token_urlsafe(32)
        row = CalendarFeed(
            id=payload.id,
            workspace_id=workspace_id,
            user_id=context.user.id,
            name=payload.name,
            token_hash=self._calendar_token_hash(token),
        )
        db.add(row)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="calendar.feed_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="calendar_feed",
                target_id=row.id,
                metadata={},
            )
        )
        await db.flush()
        return row, token

    async def list_feeds(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[CalendarFeed]:
        await self._authorize(db, context, workspace_id, request_id)
        return list(
            (
                await db.scalars(
                    select(CalendarFeed)
                    .where(
                        CalendarFeed.workspace_id == workspace_id,
                        CalendarFeed.user_id == context.user.id,
                    )
                    .order_by(CalendarFeed.created_at.desc(), CalendarFeed.id.desc())
                )
            ).all()
        )

    async def revoke_feed(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        feed_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> CalendarFeed:
        await self._authorize(db, context, workspace_id, request_id)
        row = await db.scalar(
            select(CalendarFeed)
            .where(
                CalendarFeed.id == feed_id,
                CalendarFeed.workspace_id == workspace_id,
                CalendarFeed.user_id == context.user.id,
            )
            .with_for_update()
        )
        if row is None:
            raise self._not_found("Calendar feed")
        if row.version != expected_version:
            raise self._conflict("The calendar feed changed.")
        if row.status == "active":
            row.status = "revoked"
            row.version += 1
            row.revoked_at = utc_now()
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="calendar.feed_revoked",
                    result="success",
                    actor_id=context.user.id,
                    workspace_id=workspace_id,
                    target_type="calendar_feed",
                    target_id=row.id,
                    metadata={},
                )
            )
            await db.flush()
        return row

    async def render_calendar(self, db: AsyncSession, token: str) -> str:
        feed = await db.scalar(
            select(CalendarFeed).where(
                CalendarFeed.token_hash == self._calendar_token_hash(token),
                CalendarFeed.status == "active",
            )
        )
        if feed is None:
            raise self._not_found("Calendar feed")
        membership = await db.scalar(
            select(WorkspaceMembership.id).where(
                WorkspaceMembership.workspace_id == feed.workspace_id,
                WorkspaceMembership.user_id == feed.user_id,
                WorkspaceMembership.status == "active",
            )
        )
        if membership is None:
            raise self._not_found("Calendar feed")
        spaces = list(
            (
                await db.scalars(
                    select(Space.id).where(
                        Space.workspace_id == feed.workspace_id,
                        Space.status == "active",
                        or_(Space.visibility == "shared", Space.owner_user_id == feed.user_id),
                    )
                )
            ).all()
        )
        tasks = (
            list(
                (
                    await db.scalars(
                        select(Task).where(
                            Task.workspace_id == feed.workspace_id,
                            Task.space_id.in_(spaces),
                            Task.due_at.is_not(None),
                            Task.deleted_at.is_(None),
                            Task.status.not_in(("done", "cancelled")),
                        )
                    )
                ).all()
            )
            if spaces
            else []
        )
        exams = list(
            (
                await db.scalars(
                    select(Exam).where(
                        Exam.workspace_id == feed.workspace_id,
                        Exam.user_id == feed.user_id,
                        Exam.exam_at.is_not(None),
                        Exam.status.not_in(("completed", "archived")),
                        Exam.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        reviews = (
            (
                await db.execute(
                    select(ReviewSchedule, Topic.title)
                    .join(Topic, Topic.id == ReviewSchedule.topic_id)
                    .where(
                        ReviewSchedule.workspace_id == feed.workspace_id,
                        ReviewSchedule.user_id == feed.user_id,
                        ReviewSchedule.space_id.in_(spaces),
                        ReviewSchedule.status.not_in(("completed", "skipped")),
                        ReviewSchedule.deleted_at.is_(None),
                    )
                )
            ).all()
            if spaces
            else []
        )
        events: list[tuple[str, UUID, str, datetime]] = []
        events.extend(("task", row.id, row.title, row.due_at) for row in tasks if row.due_at)
        events.extend(("exam", row.id, row.title, row.exam_at) for row in exams if row.exam_at)
        events.extend(
            ("review", row.id, f"Review: {title}", row.next_review_at) for row, title in reviews
        )
        return self._ical(feed.name, events)

    async def _authorize(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> None:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )

    @staticmethod
    async def emit(
        db: AsyncSession,
        *,
        workspace_id: UUID,
        recipient_user_id: UUID,
        category: NotificationCategory,
        title: str,
        summary: str,
        dedupe_key: str,
        target_type: str | None = None,
        target_id: UUID | None = None,
    ) -> None:
        preference = await db.get(NotificationPreference, (workspace_id, recipient_user_id))
        enabled = preference.enabled_categories if preference else ALL_CATEGORIES
        if category != "security" and category not in enabled:
            return
        await db.execute(
            insert(Notification)
            .values(
                workspace_id=workspace_id,
                recipient_user_id=recipient_user_id,
                category=category,
                title=title[:160],
                summary=summary[:500],
                target_type=target_type,
                target_id=target_id,
                dedupe_key=dedupe_key[:160],
            )
            .on_conflict_do_nothing(
                index_elements=["workspace_id", "recipient_user_id", "dedupe_key"]
            )
        )

    @staticmethod
    def _result(
        object_type: SearchType,
        object_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        title: str,
        body: str,
        updated_at: datetime,
        space: Space,
        query: str,
    ) -> SearchResult:
        return SearchResult(
            object_type=object_type,
            object_id=object_id,
            workspace_id=workspace_id,
            space_id=space_id,
            title=title,
            snippet=EngagementService._snippet(f"{title} {body}", query),
            permission_source="shared_space" if space.visibility == "shared" else "private_owner",
            updated_at=updated_at,
        )

    @staticmethod
    def _snippet(value: str, query: str) -> str:
        normalized = " ".join(value.replace("\x00", " ").split())
        index = normalized.casefold().find(query.casefold())
        start = max(0, index - 60) if index >= 0 else 0
        return normalized[start : start + 180]

    @staticmethod
    def _escape_like(value: str) -> str:
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    def _calendar_token_hash(self, token: str) -> str:
        return self._security.token_hash(f"calendar-feed:{token}")

    @staticmethod
    def _ical(name: str, events: list[tuple[str, UUID, str, datetime]]) -> str:
        now = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Logion//Learning Calendar//EN",
            "CALSCALE:GREGORIAN",
            f"X-WR-CALNAME:{EngagementService._ical_text(name)}",
        ]
        for kind, object_id, title, occurs_at in events:
            utc_value = occurs_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{kind}-{object_id}@logion",
                    f"DTSTAMP:{now}",
                    f"DTSTART:{utc_value}",
                    f"SUMMARY:{EngagementService._ical_text(title)}",
                    "END:VEVENT",
                ]
            )
        lines.append("END:VCALENDAR")
        return (
            "\r\n".join(
                folded for line in lines for folded in EngagementService._fold_ical_line(line)
            )
            + "\r\n"
        )

    @staticmethod
    def _ical_text(value: str) -> str:
        return (
            value.replace("\\", "\\\\")
            .replace("\r", " ")
            .replace("\n", " ")
            .replace(",", "\\,")
            .replace(";", "\\;")
        )

    @staticmethod
    def _fold_ical_line(value: str) -> list[str]:
        lines: list[str] = []
        current = ""
        max_bytes = 73
        for character in value:
            candidate = current + character
            if current and len(candidate.encode()) > max_bytes:
                lines.append(current)
                current = " " + character
                max_bytes = 74
            else:
                current = candidate
        lines.append(current)
        return lines

    @staticmethod
    def _not_found(name: str) -> APIError:
        return APIError(code="RESOURCE_NOT_FOUND", message=f"{name} not found.", status_code=404)

    @staticmethod
    def _conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)
