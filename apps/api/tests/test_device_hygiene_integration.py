import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.device_hygiene import revoke_inactive_devices
from logion_api.identity.models import AuditEvent, AuthSession, Device, RefreshToken, User
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, IdentityService
from logion_api.main import app
from sqlalchemy import func, select, text

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def identity() -> IdentityService:
    settings = get_settings()
    return IdentityService(settings, IdentitySecurity(settings.secret_key.get_secret_value()))


async def seed_device() -> tuple[User, Device]:
    now = datetime.now(UTC)
    async with session_factory() as db:
        user = User(
            email=f"hygiene-{uuid4()}@example.com",
            email_normalized=f"hygiene-{uuid4()}@example.com",
            email_verified_at=now,
        )
        db.add(user)
        await db.flush()
        device = Device(
            user_id=user.id, name="Synthetic device", first_seen_at=now - timedelta(days=60)
        )
        db.add(device)
        await db.commit()
        return user, device


async def issue(db, user, device):
    return await identity().issue_session(
        db,
        user=user,
        device=device,
        device_name="Synthetic fresh login",
        platform="web",
        request_id="hygiene-test",
        ip_address=None,
        user_agent=None,
        event_type="identity.login_succeeded",
    )


async def test_logout_preserves_only_device_cookie_and_requires_new_authentication() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.181", 55000)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as client:
        payload = {
            "email": f"logout-{uuid4()}@example.com",
            "password": "synthetic-password-123",
            "device_name": "Synthetic browser",
        }
        assert (await client.post("/api/v1/auth/register", json=payload)).status_code == 201
        device_id = client.cookies["logion_device"]
        old_access = client.cookies["logion_access"]
        old_refresh = client.cookies["logion_refresh"]
        old_csrf = client.cookies["logion_csrf"]
        response = await client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": old_csrf})
        assert response.status_code == 200, response.text
        cookies = response.headers.get_list("set-cookie")
        assert len(cookies) == 3
        assert all("logion_device" not in cookie for cookie in cookies)
        assert client.cookies["logion_device"] == device_id
        assert all(
            name not in client.cookies
            for name in ("logion_access", "logion_refresh", "logion_csrf")
        )
        assert (await client.get("/api/v1/auth/session")).status_code == 401
        denied = await client.post("/api/v1/auth/login", json={**payload, "password": "wrong"})
        assert denied.status_code == 401
        assert (await client.post("/api/v1/auth/login", json=payload)).status_code == 200
        assert client.cookies["logion_device"] == device_id
        assert client.cookies["logion_access"] != old_access
        security = IdentitySecurity(get_settings().secret_key.get_secret_value())
        async with session_factory() as db:
            session = await db.scalar(
                select(AuthSession).where(
                    AuthSession.access_token_hash == security.token_hash(old_access)
                )
            )
            token = await db.scalar(
                select(RefreshToken).where(
                    RefreshToken.token_hash == security.token_hash(old_refresh)
                )
            )
            assert session is not None and session.revoked_at is not None
            assert token is not None and token.status == "revoked"
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(Device)
                    .where(Device.user_id == session.user_id)
                )
                == 1
            )


async def test_device_list_and_cleanup_use_actual_session_end_and_preserve_history() -> None:
    # Keep exact-boundary fixtures recent during later real-time cleanup tests.
    now = datetime.now(UTC) + timedelta(days=1)
    cutoff = now - timedelta(days=30)
    user, initial = await seed_device()
    async with session_factory() as db:
        current = await issue(db, user, initial)
        by_name = {}
        # offset is the later expiry; access-only and refresh-only must both stay visible.
        cases = [
            ("access_only", 1, -31, None),
            ("refresh_only", -31, 1, None),
            ("expired", -31, -31, None),
            ("recent_end", -29, -29, None),
            ("boundary", -30, -30, None),
            ("revoked_old", 10, 10, -31),
            ("revoked_recent", 10, 10, -29),
            ("late_failure", -40, -40, -1),
        ]
        for name, access, refresh, revoked in cases:
            device = Device(user_id=user.id, name=name, first_seen_at=now - timedelta(days=60))
            db.add(device)
            await db.flush()
            issued = await issue(db, user, device)
            session = issued.session
            session.access_expires_at = now + timedelta(days=access)
            session.refresh_expires_at = now + timedelta(days=refresh)
            session.revoked_at = now + timedelta(days=revoked) if revoked is not None else None
            by_name[name] = device
        for name, created in [
            ("empty_old", cutoff - timedelta(seconds=1)),
            ("empty_boundary", cutoff),
            ("empty_recent", now),
        ]:
            device = Device(user_id=user.id, name=name, first_seen_at=created)
            db.add(device)
            by_name[name] = device
        await db.commit()
        expected_visible = {initial.id, by_name["access_only"].id, by_name["refresh_only"].id}
        context = AuthContext(user=user, device=initial, session=current.session)
        assert {d.id for d in await identity().list_devices(db, context)} == expected_visible
        counts = [
            await db.scalar(select(func.count()).select_from(model))
            for model in (Device, AuthSession, RefreshToken)
        ]
        await revoke_inactive_devices(db, now=now, batch_size=100)
        await db.commit()
        for name, device in by_name.items():
            await db.refresh(device)
            assert (device.revoked_at is not None) == (
                name in {"expired", "revoked_old", "late_failure", "empty_old"}
            ), name
        assert counts == [
            await db.scalar(select(func.count()).select_from(model))
            for model in (Device, AuthSession, RefreshToken)
        ]
        assert await revoke_inactive_devices(db, now=now, batch_size=100) == 0
        audits = list(
            await db.scalars(
                select(AuditEvent).where(
                    AuditEvent.actor_id == user.id,
                    AuditEvent.event_type == "identity.device_auto_revoked",
                )
            )
        )
        assert len(audits) == 4
        assert all(a.event_metadata == {"reason": "inactive_30_days"} for a in audits)


async def wait_for_lock(pid: int) -> None:
    # Observe the actual database wait; no timing delay or mocked locks.
    async with asyncio.timeout(5), session_factory() as observer:
        while not await observer.scalar(
            text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}
        ):
            pass


async def test_reused_device_takes_user_fk_lock_before_device() -> None:
    user, device = await seed_device()
    async with session_factory() as blocker, session_factory() as login:
        await blocker.scalar(select(User).where(User.id == user.id).with_for_update())
        pid = await login.scalar(text("SELECT pg_backend_pid()"))

        async def sign_in():
            reused = await identity().find_reusable_device(login, user.id, str(device.id))
            result = await issue(login, user, reused)
            await login.commit()
            return result

        task = asyncio.create_task(sign_in())
        try:
            await wait_for_lock(pid)
            # A Device -> User implementation holds Device here and fails NOWAIT.
            await blocker.scalar(
                select(Device).where(Device.id == device.id).with_for_update(nowait=True, of=Device)
            )
            await blocker.commit()
            result = await asyncio.wait_for(task, 5)
            assert result.device.id == device.id
        finally:
            await blocker.rollback()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def test_login_lock_makes_cleaner_skip_and_fresh_session_prevents_revocation() -> None:
    user, device = await seed_device()
    async with session_factory() as login, session_factory() as cleaner:
        reused = await identity().find_reusable_device(login, user.id, str(device.id))
        assert reused is not None
        assert await revoke_inactive_devices(cleaner, now=datetime.now(UTC)) == 0
        await cleaner.commit()
        await issue(login, user, reused)
        await login.commit()
        assert await revoke_inactive_devices(cleaner, now=datetime.now(UTC)) == 0
        await cleaner.commit()
    async with session_factory() as db:
        stored = await db.get(Device, device.id)
        assert stored is not None and stored.revoked_at is None


async def test_cleaner_wins_then_login_creates_new_identity_without_resurrection() -> None:
    user, device = await seed_device()
    async with session_factory() as cleaner, session_factory() as login:
        assert await revoke_inactive_devices(cleaner, now=datetime.now(UTC)) == 1
        pid = await login.scalar(text("SELECT pg_backend_pid()"))

        async def sign_in():
            reused = await identity().find_reusable_device(login, user.id, str(device.id))
            assert reused is None
            result = await issue(login, user, reused)
            await login.commit()
            return result

        task = asyncio.create_task(sign_in())
        try:
            await wait_for_lock(pid)
            await cleaner.commit()
            result = await asyncio.wait_for(task, 5)
            assert result.device.id != device.id
        finally:
            await cleaner.rollback()
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    async with session_factory() as db:
        stored = await db.get(Device, device.id)
        assert stored is not None and stored.revoked_at is not None


async def test_other_sessions_require_boundaries_and_invalidate_access_and_refresh() -> None:
    clients = [
        AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{182 + i}", 55000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        )
        for i in range(3)
    ]
    owner, other, stranger = clients
    payload = {
        "email": f"sessions-{uuid4()}@example.com",
        "password": "synthetic-password-123",
        "device_name": "Current device",
    }
    path = "/api/v1/auth/sessions/others"
    try:
        assert (await owner.post("/api/v1/auth/register", json=payload)).status_code == 201
        assert (
            await other.post("/api/v1/auth/login", json={**payload, "device_name": "Other device"})
        ).status_code == 200
        assert (
            await stranger.post(
                "/api/v1/auth/register",
                json={**payload, "email": f"stranger-{uuid4()}@example.com"},
            )
        ).status_code == 201
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        assert (await owner.delete(path)).status_code == 403
        assert (
            await owner.delete(path, headers={**csrf, "Origin": "https://evil.example"})
        ).status_code == 403
        assert (await owner.delete(path, headers={"X-CSRF-Token": "wrong"})).status_code == 403
        assert (await other.get("/api/v1/auth/session")).status_code == 200
        security = IdentitySecurity(get_settings().secret_key.get_secret_value())
        async with session_factory() as db:
            session = await db.scalar(
                select(AuthSession).where(
                    AuthSession.access_token_hash
                    == security.token_hash(owner.cookies["logion_access"])
                )
            )
            assert session is not None
            original_created = session.created_at
            session.created_at = datetime.now(UTC) - timedelta(days=1)
            await db.commit()
        denied = await owner.delete(path, headers=csrf)
        assert denied.status_code == 403 and denied.json()["code"] == "AUTH_RECENT_LOGIN_REQUIRED"
        async with session_factory() as db:
            stored = await db.get(AuthSession, session.id)
            stored.created_at = original_created
            await db.commit()
        response = await owner.delete(path, headers=csrf)
        assert response.status_code == 200, response.text
        assert (await owner.get("/api/v1/auth/session")).status_code == 200
        assert (await stranger.get("/api/v1/auth/session")).status_code == 200
        assert (await other.get("/api/v1/auth/session")).status_code == 401
        assert (
            await other.post(
                "/api/v1/auth/refresh", headers={"X-CSRF-Token": other.cookies["logion_csrf"]}
            )
        ).status_code == 401
        listed = (await owner.get("/api/v1/auth/devices")).json()["devices"]
        assert len(listed) == 1 and listed[0]["current"]
        async with session_factory() as db:
            devices = list(
                await db.scalars(select(Device).where(Device.user_id == session.user_id))
            )
            assert len(devices) == 2 and all(d.revoked_at is None for d in devices)
            audit = await db.scalar(
                select(AuditEvent).where(
                    AuditEvent.actor_id == session.user_id,
                    AuditEvent.event_type == "identity.other_sessions_revoked",
                )
            )
            assert audit is not None and audit.event_metadata == {"count": 1}
        for _ in range(9):
            assert (await owner.delete(path, headers=csrf)).status_code == 200
        assert (await owner.delete(path, headers=csrf)).status_code == 429
    finally:
        for client in clients:
            await client.aclose()
