"""Bounded revocation of device identities whose sessions ended over 30 days ago."""

from datetime import UTC, datetime, timedelta
from time import monotonic

from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from logion_api.db import session_factory
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuthSession, Device


def session_valid_until() -> ColumnElement[datetime]:
    # Access may remain valid briefly after the fixed refresh deadline.
    return func.greatest(AuthSession.access_expires_at, AuthSession.refresh_expires_at)


def session_ended_at() -> ColumnElement[datetime]:
    expiry = session_valid_until()
    return func.least(func.coalesce(AuthSession.revoked_at, expiry), expiry)


async def revoke_inactive_devices(db: AsyncSession, *, now: datetime, batch_size: int = 100) -> int:
    cutoff = now - timedelta(days=30)
    recent_session = exists(
        select(AuthSession.id).where(
            AuthSession.device_id == Device.id,
            session_ended_at() >= cutoff,
        )
    )
    devices = list(
        await db.scalars(
            select(Device)
            .where(
                Device.revoked_at.is_(None),
                Device.first_seen_at < cutoff,
                ~recent_session,
            )
            .order_by(Device.id)
            .limit(batch_size)
            .with_for_update(skip_locked=True, of=Device)
            .execution_options(populate_existing=True)
        )
    )
    count = 0
    for device in devices:
        # A separate READ COMMITTED statement sees sessions committed before our lock.
        recent = await db.scalar(
            select(
                exists().where(
                    AuthSession.device_id == device.id,
                    session_ended_at() >= cutoff,
                )
            )
        )
        if recent:
            continue
        device.revoked_at = now
        db.add(
            new_audit_event(
                request_id="device-hygiene",
                event_type="identity.device_auto_revoked",
                result="success",
                actor_id=device.user_id,
                target_type="device",
                target_id=device.id,
                metadata={"reason": "inactive_30_days"},
            )
        )
        count += 1
    return count


class DeviceHygieneService:
    def __init__(self) -> None:
        self._next_scan = 0.0

    async def execute_next(self) -> bool:
        if monotonic() < self._next_scan:
            return False
        async with session_factory() as db:
            count = await revoke_inactive_devices(db, now=datetime.now(UTC))
            await db.commit()
        # Drain full batches, then poll every 15 minutes without delaying other queues.
        self._next_scan = monotonic() + (900 if count < 100 else 0)
        return count > 0
