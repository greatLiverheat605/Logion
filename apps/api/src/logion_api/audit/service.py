import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent
from logion_api.identity.security import IdentitySecurity


@dataclass(frozen=True)
class AuditPage:
    events: list[AuditEvent]
    next_cursor: str | None


@dataclass(frozen=True)
class AuditCursorPosition:
    occurred_at: datetime
    event_id: UUID


class AuditQueryService:
    def __init__(self, security: IdentitySecurity) -> None:
        self._security = security

    async def list_personal_identity_events(
        self,
        db: AsyncSession,
        user_id: UUID,
        *,
        page_size: int,
        cursor: str | None,
        event_type: str | None,
        result: str | None,
        occurred_after: datetime | None,
        occurred_before: datetime | None,
    ) -> AuditPage:
        return await self._list(
            db,
            scope=f"user:{user_id}",
            scope_filters=(
                AuditEvent.actor_id == user_id,
                AuditEvent.event_type.like("identity.%"),
            ),
            page_size=page_size,
            cursor=cursor,
            event_type=event_type,
            result=result,
            occurred_after=occurred_after,
            occurred_before=occurred_before,
        )

    async def list_workspace_events(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        *,
        page_size: int,
        cursor: str | None,
        event_type: str | None,
        result: str | None,
        occurred_after: datetime | None,
        occurred_before: datetime | None,
    ) -> AuditPage:
        return await self._list(
            db,
            scope=f"workspace:{workspace_id}",
            scope_filters=(AuditEvent.workspace_id == workspace_id,),
            page_size=page_size,
            cursor=cursor,
            event_type=event_type,
            result=result,
            occurred_after=occurred_after,
            occurred_before=occurred_before,
        )

    async def _list(
        self,
        db: AsyncSession,
        *,
        scope: str,
        scope_filters: tuple[ColumnElement[bool], ...],
        page_size: int,
        cursor: str | None,
        event_type: str | None,
        result: str | None,
        occurred_after: datetime | None,
        occurred_before: datetime | None,
    ) -> AuditPage:
        after = self._normalize_time(occurred_after)
        before = self._normalize_time(occurred_before)
        if after is not None and before is not None and after >= before:
            raise APIError(
                code="AUDIT_RANGE_INVALID",
                message="The audit time range is invalid.",
                status_code=422,
            )
        fingerprint = self._filter_fingerprint(event_type, result, after, before)
        position = (
            self.decode_cursor(cursor, scope=scope, fingerprint=fingerprint) if cursor else None
        )
        filters: list[ColumnElement[bool]] = list(scope_filters)
        if event_type is not None:
            filters.append(AuditEvent.event_type == event_type)
        if result is not None:
            filters.append(AuditEvent.result == result)
        if after is not None:
            filters.append(AuditEvent.occurred_at >= after)
        if before is not None:
            filters.append(AuditEvent.occurred_at < before)
        if position is not None:
            filters.append(
                or_(
                    AuditEvent.occurred_at < position.occurred_at,
                    and_(
                        AuditEvent.occurred_at == position.occurred_at,
                        AuditEvent.id < position.event_id,
                    ),
                )
            )
        rows = list(
            (
                await db.scalars(
                    select(AuditEvent)
                    .where(*filters)
                    .order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc())
                    .limit(page_size + 1)
                )
            ).all()
        )
        has_more = len(rows) > page_size
        events = rows[:page_size]
        next_cursor = None
        if has_more and events:
            last = events[-1]
            next_cursor = self.encode_cursor(
                scope=scope,
                fingerprint=fingerprint,
                occurred_at=last.occurred_at,
                event_id=last.id,
            )
        return AuditPage(events=events, next_cursor=next_cursor)

    def encode_cursor(
        self,
        *,
        scope: str,
        fingerprint: str,
        occurred_at: datetime,
        event_id: UUID,
    ) -> str:
        payload = json.dumps(
            {
                "event_id": str(event_id),
                "filter": fingerprint,
                "occurred_at": occurred_at.astimezone(UTC).isoformat(),
                "scope": scope,
                "version": 1,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
        signature = self._security.token_hash(f"audit-cursor:{payload}")
        encoded = base64.urlsafe_b64encode(f"{payload}.{signature}".encode()).decode()
        return encoded.rstrip("=")

    def decode_cursor(
        self,
        cursor: str,
        *,
        scope: str,
        fingerprint: str,
    ) -> AuditCursorPosition:
        try:
            if not 1 <= len(cursor) <= 1024:
                raise ValueError
            padding = "=" * (-len(cursor) % 4)
            raw = base64.b64decode(cursor + padding, altchars=b"-_", validate=True).decode()
            payload, supplied_signature = raw.rsplit(".", 1)
            expected_signature = self._security.token_hash(f"audit-cursor:{payload}")
            if not self._security.constant_time_equal(supplied_signature, expected_signature):
                raise ValueError
            values = json.loads(payload)
            if (
                not isinstance(values, dict)
                or set(values) != {"event_id", "filter", "occurred_at", "scope", "version"}
                or values.get("version") != 1
                or values.get("scope") != scope
                or values.get("filter") != fingerprint
            ):
                raise ValueError
            occurred_at = datetime.fromisoformat(values["occurred_at"])
            if occurred_at.tzinfo is None:
                raise ValueError
            event_id = UUID(values["event_id"])
        except (UnicodeDecodeError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            raise self._invalid_cursor() from exc
        return AuditCursorPosition(occurred_at=occurred_at.astimezone(UTC), event_id=event_id)

    def filter_fingerprint(
        self,
        event_type: str | None,
        result: str | None,
        occurred_after: datetime | None,
        occurred_before: datetime | None,
    ) -> str:
        return self._filter_fingerprint(
            event_type,
            result,
            self._normalize_time(occurred_after),
            self._normalize_time(occurred_before),
        )

    def _filter_fingerprint(
        self,
        event_type: str | None,
        result: str | None,
        occurred_after: datetime | None,
        occurred_before: datetime | None,
    ) -> str:
        canonical = "|".join(
            (
                event_type or "",
                result or "",
                occurred_after.isoformat() if occurred_after else "",
                occurred_before.isoformat() if occurred_before else "",
            )
        )
        return self._security.token_hash(f"audit-filter:{canonical}")

    @staticmethod
    def _normalize_time(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise APIError(
                code="AUDIT_RANGE_INVALID",
                message="Audit timestamps must include a timezone.",
                status_code=422,
            )
        return value.astimezone(UTC)

    @staticmethod
    def _invalid_cursor() -> APIError:
        return APIError(
            code="AUDIT_CURSOR_INVALID",
            message="The audit cursor is invalid or no longer applies.",
            status_code=400,
        )
