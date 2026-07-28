from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent, RefreshToken
from logion_api.identity.security import IdentitySecurity
from logion_api.main import app
from sqlalchemy import select


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
