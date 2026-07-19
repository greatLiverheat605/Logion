from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app


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
        current_device = next(
            device for device in devices.json()["devices"] if device["current"]
        )
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
