from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent, AuthSession, Device, RefreshToken, User
from logion_api.identity.security import IdentitySecurity
from logion_api.main import app
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "device_state", ["missing", "malformed", "unknown", "revoked", "cross_user"]
)
async def test_login_never_reuses_untrusted_device_identity(device_state: str) -> None:
    headers = {"Origin": "http://test"}
    payload = {
        "email": f"device-boundary-{uuid4()}@example.com",
        "password": "a-strong-password-123",
        "device_name": "Original browser",
    }
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=headers
    ) as original:
        registered = await original.post("/api/v1/auth/register", json=payload)
        assert registered.status_code == 201, registered.text
        user_id = UUID(registered.json()["user"]["id"])
        original_id = original.cookies["logion_device"]
        supplied_id = original_id
        if device_state == "revoked":
            revoked = await original.delete(
                f"/api/v1/auth/devices/{original_id}",
                headers={"X-CSRF-Token": original.cookies["logion_csrf"]},
            )
            assert revoked.status_code == 200, revoked.text
        elif device_state == "cross_user":
            other = await original.post(
                "/api/v1/auth/register",
                json={**payload, "email": f"other-device-{uuid4()}@example.com"},
            )
            assert other.status_code == 201, other.text
            supplied_id = original.cookies["logion_device"]
        elif device_state == "malformed":
            supplied_id = "invalid-device-id"
        elif device_state == "unknown":
            supplied_id = str(uuid4())

    async with session_factory() as db:
        old = await db.get(Device, UUID(original_id))
        assert old is not None
        revoked_at = old.revoked_at
        borrowed = await db.get(Device, UUID(supplied_id)) if device_state == "cross_user" else None
        borrowed_snapshot = (
            (borrowed.user_id, borrowed.name, borrowed.last_seen_at) if borrowed else None
        )
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers=headers
    ) as login:
        if device_state != "missing":
            login.cookies.set("logion_device", supplied_id, domain="test.local", path="/")
        assert (await login.get("/api/v1/auth/session")).status_code == 401
        signed_in = await login.post(
            "/api/v1/auth/login", json={**payload, "device_name": "New browser"}
        )
        assert signed_in.status_code == 200, signed_in.text
        assert UUID(signed_in.json()["user"]["id"]) == user_id
        new_id = UUID(login.cookies["logion_device"])
        assert str(new_id) not in (original_id, supplied_id)
        devices = await login.get("/api/v1/auth/devices")
        assert devices.status_code == 200
        current = [device for device in devices.json()["devices"] if device["current"]]
        assert len(current) == 1
        assert UUID(current[0]["id"]) == new_id
        security = IdentitySecurity(get_settings().secret_key.get_secret_value())
        async with session_factory() as db:
            owned = list(await db.scalars(select(Device).where(Device.user_id == user_id)))
            assert len(owned) == 2
            new = await db.get(Device, new_id)
            assert new is not None and new.user_id == user_id and new.revoked_at is None
            old = await db.get(Device, UUID(original_id))
            assert old is not None and old.revoked_at == revoked_at
            session = await db.scalar(
                select(AuthSession).where(
                    AuthSession.access_token_hash
                    == security.token_hash(login.cookies["logion_access"])
                )
            )
            assert (
                session is not None and session.device_id == new_id and session.user_id == user_id
            )
            if borrowed_snapshot:
                borrowed = await db.get(Device, UUID(supplied_id))
                assert borrowed is not None
                assert (borrowed.user_id, borrowed.name, borrowed.last_seen_at) == borrowed_snapshot
                assert (
                    len(
                        list(
                            await db.scalars(
                                select(Device).where(Device.user_id == borrowed.user_id)
                            )
                        )
                    )
                    == 1
                )


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "terminal", ["session_revoked", "device_revoked", "refresh_expired", "suspended"]
)
async def test_invalid_access_never_bypasses_terminal_refresh_rejection(terminal: str) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", headers={"Origin": "http://test"}
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"terminal-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Terminal browser",
            },
        )
        assert registered.status_code == 201, registered.text
        security = IdentitySecurity(get_settings().secret_key.get_secret_value())
        async with session_factory() as db:
            session = await db.scalar(
                select(AuthSession).where(
                    AuthSession.access_token_hash
                    == security.token_hash(client.cookies["logion_access"])
                )
            )
            assert session is not None
            if terminal == "session_revoked":
                session.revoked_at = datetime.now(UTC)
            elif terminal == "device_revoked":
                device = await db.get(Device, session.device_id)
                assert device is not None
                device.revoked_at = datetime.now(UTC)
            elif terminal == "refresh_expired":
                session.refresh_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            else:
                user = await db.get(User, session.user_id)
                assert user is not None
                user.status = "suspended"
            session.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        denied = await client.get("/api/v1/auth/session")
        assert denied.status_code == 401
        assert denied.headers.get_list("set-cookie") == []
        csrf = client.cookies["logion_csrf"]
        refreshed = await client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
        assert refreshed.status_code == 401
        assert refreshed.json()["code"] == "AUTH_INVALID_SESSION"
        assert len(refreshed.headers.get_list("set-cookie")) == 4
        assert not any(
            name in client.cookies
            for name in ("logion_access", "logion_refresh", "logion_csrf", "logion_device")
        )
        assert (await client.get("/api/v1/auth/session")).status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing", "expired", "rotated"])
async def test_access_failure_can_refresh_without_replacing_device(failure: str) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as client:
        payload = {
            "email": f"continuity-{uuid4()}@example.com",
            "password": "a-strong-password-123",
            "device_name": "Continuity browser",
        }
        registered = await client.post("/api/v1/auth/register", json=payload)
        assert registered.status_code == 201, registered.text
        device_id = client.cookies["logion_device"]
        csrf = client.cookies["logion_csrf"]
        old_access = client.cookies["logion_access"]
        security = IdentitySecurity(get_settings().secret_key.get_secret_value())
        async with session_factory() as db:
            session = await db.scalar(
                select(AuthSession).where(
                    AuthSession.access_token_hash == security.token_hash(old_access)
                )
            )
            assert session is not None
            session_id = session.id
            created_at = session.created_at
            if failure == "expired":
                session.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
                await db.commit()
        if failure == "missing":
            client.cookies.delete("logion_access")
        elif failure == "rotated":
            rotated = await client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
            assert rotated.status_code == 200, rotated.text
            # Simulate a request sent before rotation, processed after it. Keep the
            # new browser jar and verify the stale response does not clear it.
        for path in ("/api/v1/auth/session", "/api/v1/auth/devices"):
            headers = {"Cookie": f"logion_access={old_access}"} if failure == "rotated" else {}
            failed = await client.get(path, headers=headers)
            assert failed.status_code == 401
            assert failed.headers["cache-control"] == "no-store"
            assert failed.headers.get_list("set-cookie") == []
        if failure == "rotated":
            assert (await client.get("/api/v1/auth/session")).status_code == 200
        recovered = await client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf})
        assert recovered.status_code == 200, recovered.text
        assert client.cookies["logion_device"] == device_id
        assert (await client.get("/api/v1/auth/session")).status_code == 200
        async with session_factory() as db:
            session = await db.get(AuthSession, session_id)
            assert session is not None
            assert session.created_at == created_at
        for _ in range(3):
            signed_in = await client.post("/api/v1/auth/login", json=payload)
            assert signed_in.status_code == 200, signed_in.text
            assert client.cookies["logion_device"] == device_id
        devices = await client.get("/api/v1/auth/devices")
        assert len(devices.json()["devices"]) == 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_register_login_refresh_reuse_and_device_revocation() -> None:
    email = f"phase1-{uuid4()}@example.com"
    headers = {"Origin": "http://test"}
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers=headers,
    ) as client:
        register = await client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "CI browser",
            },
        )
        assert register.status_code == 201, register.text
        assert register.json()["user"]["email"] == email
        assert "logion_access" in client.cookies
        assert "logion_refresh" in client.cookies
        assert "logion_csrf" in client.cookies

        me = await client.get("/api/v1/auth/me")
        assert me.status_code == 200
        assert me.json()["email"] == email

        current_session = await client.get("/api/v1/auth/session")
        assert current_session.status_code == 200
        assert current_session.headers["cache-control"] == "no-store"
        assert current_session.json()["user"]["email"] == email
        assert current_session.json()["session_expires_at"] == register.json()["session_expires_at"]

        devices = await client.get("/api/v1/auth/devices")
        assert devices.status_code == 200
        assert len(devices.json()["devices"]) == 1
        device_id = devices.json()["devices"][0]["id"]

        old_refresh = client.cookies["logion_refresh"]
        csrf = client.cookies["logion_csrf"]
        refreshed = await client.post(
            "/api/v1/auth/refresh",
            headers={"X-CSRF-Token": csrf},
        )
        assert refreshed.status_code == 200, refreshed.text
        assert client.cookies["logion_refresh"] != old_refresh

        invalid_csrf_client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={**headers, "X-CSRF-Token": "invalid-csrf"},
        )
        invalid_csrf_client.cookies.set(
            "logion_refresh",
            old_refresh,
            domain="test.local",
            path="/",
        )
        invalid_csrf_client.cookies.set(
            "logion_csrf",
            "invalid-csrf",
            domain="test.local",
            path="/",
        )
        try:
            invalid_csrf = await invalid_csrf_client.post("/api/v1/auth/refresh")
        finally:
            await invalid_csrf_client.aclose()
        assert invalid_csrf.status_code == 403
        assert invalid_csrf.json()["code"] == "AUTH_CSRF_INVALID"

        recovery_client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={**headers, "X-CSRF-Token": csrf},
        )
        recovery_client.cookies.set(
            "logion_refresh",
            old_refresh,
            domain="test.local",
            path="/",
        )
        recovery_client.cookies.set(
            "logion_csrf",
            csrf,
            domain="test.local",
            path="/",
        )
        try:
            recovered = await recovery_client.post("/api/v1/auth/refresh")
        finally:
            await recovery_client.aclose()
        assert recovered.status_code == 200, recovered.text
        assert recovery_client.cookies["logion_refresh"] != old_refresh

        second_recovery_client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={**headers, "X-CSRF-Token": csrf},
        )
        second_recovery_client.cookies.set(
            "logion_refresh",
            old_refresh,
            domain="test.local",
            path="/",
        )
        second_recovery_client.cookies.set(
            "logion_csrf",
            csrf,
            domain="test.local",
            path="/",
        )
        try:
            recovered_again = await second_recovery_client.post("/api/v1/auth/refresh")
        finally:
            await second_recovery_client.aclose()
        assert recovered_again.status_code == 200, recovered_again.text
        assert second_recovery_client.cookies["logion_refresh"] != old_refresh

        settings = get_settings()
        security = IdentitySecurity(settings.secret_key.get_secret_value())
        async with session_factory() as db:
            stale_token = await db.scalar(
                select(RefreshToken).where(
                    RefreshToken.token_hash == security.token_hash(old_refresh)
                )
            )
            assert stale_token is not None
            recovered_event = await db.scalar(
                select(AuditEvent.id).where(
                    AuditEvent.event_type == "identity.refresh_rotation_recovered",
                    AuditEvent.target_id == stale_token.session_id,
                )
            )
            assert recovered_event is not None
            stale_token.used_at = datetime.now(UTC) - timedelta(
                seconds=settings.refresh_reuse_grace_seconds + 1
            )
            await db.commit()

        reuse_client = AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
            headers={**headers, "X-CSRF-Token": csrf},
        )
        reuse_client.cookies.set(
            "logion_refresh",
            old_refresh,
            domain="test.local",
            path="/",
        )
        reuse_client.cookies.set(
            "logion_csrf",
            csrf,
            domain="test.local",
            path="/",
        )
        try:
            reused = await reuse_client.post("/api/v1/auth/refresh")
        finally:
            await reuse_client.aclose()
        assert reused.status_code == 401
        assert reused.json()["code"] == "AUTH_REFRESH_REUSED"
        assert "logion_access" not in reuse_client.cookies
        assert "logion_refresh" not in reuse_client.cookies
        assert "logion_csrf" not in reuse_client.cookies
        assert "logion_device" not in reuse_client.cookies

        revoked_me = await client.get("/api/v1/auth/me")
        assert revoked_me.status_code == 401

    async with AsyncClient(
        transport=ASGITransport(app),
        base_url="http://test",
        headers=headers,
    ) as login_client:
        logged_in = await login_client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Recovery browser",
            },
        )
        assert logged_in.status_code == 200
        csrf = login_client.cookies["logion_csrf"]
        revoked = await login_client.delete(
            f"/api/v1/auth/devices/{device_id}",
            headers={"X-CSRF-Token": csrf},
        )
        assert revoked.status_code == 200

        devices = await login_client.get("/api/v1/auth/devices")
        assert devices.status_code == 200
        current_device = next(device for device in devices.json()["devices"] if device["current"])
        revoked_current = await login_client.delete(
            f"/api/v1/auth/devices/{current_device['id']}",
            headers={"X-CSRF-Token": csrf},
        )
        assert revoked_current.status_code == 200
        assert "logion_access" not in login_client.cookies
        assert "logion_refresh" not in login_client.cookies
        assert "logion_csrf" not in login_client.cookies
        assert "logion_device" not in login_client.cookies

        revoked_current_me = await login_client.get("/api/v1/auth/me")
        assert revoked_current_me.status_code == 401
