import time
from uuid import uuid4

import pyotp
import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app


async def _register_and_enable_totp(
    client: AsyncClient,
    *,
    email: str,
    device_name: str,
) -> tuple[str, list[str]]:
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "a-strong-password-123",
            "device_name": device_name,
        },
    )
    assert registered.status_code == 201, registered.text
    csrf = client.cookies["logion_csrf"]
    enrollment = await client.post(
        "/api/v1/auth/totp/enrollment",
        headers={"X-CSRF-Token": csrf},
    )
    assert enrollment.status_code == 200, enrollment.text
    assert enrollment.headers["cache-control"] == "no-store"
    secret = enrollment.json()["secret"]
    previous_step_code = pyotp.TOTP(secret).at(int(time.time()) - 30)
    activated = await client.post(
        "/api/v1/auth/totp/enrollment/verify",
        headers={"X-CSRF-Token": csrf},
        json={"code": previous_step_code},
    )
    assert activated.status_code == 200, activated.text
    assert activated.headers["cache-control"] == "no-store"
    recovery_codes = activated.json()["recovery_codes"]
    assert len(recovery_codes) == 10
    assert len(set(recovery_codes)) == 10
    return secret, recovery_codes


@pytest.mark.integration
@pytest.mark.asyncio
async def test_totp_login_replay_recovery_regeneration_and_disable() -> None:
    origin = "http://test"
    headers = {"Origin": origin}
    email = f"totp-{uuid4()}@example.com"

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as enrollment_client:
        secret, recovery_codes = await _register_and_enable_totp(
            enrollment_client,
            email=email,
            device_name="Enrollment browser",
        )

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as totp_client:
        password = await totp_client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "TOTP browser",
            },
        )
        assert password.status_code == 202, password.text
        assert password.headers["cache-control"] == "no-store"
        assert "logion_access" not in totp_client.cookies
        challenge = password.json()["challenge_token"]

        invalid = await totp_client.post(
            "/api/v1/auth/totp/login/verify",
            json={"challenge_token": challenge, "method": "totp", "code": "000000"},
        )
        assert invalid.status_code == 401
        assert invalid.json()["code"] == "AUTH_MFA_INVALID"

        current_code = pyotp.TOTP(secret).now()
        verified = await totp_client.post(
            "/api/v1/auth/totp/login/verify",
            json={"challenge_token": challenge, "method": "totp", "code": current_code},
        )
        assert verified.status_code == 200, verified.text
        assert "logion_access" in totp_client.cookies

        replayed_challenge = await totp_client.post(
            "/api/v1/auth/totp/login/verify",
            json={"challenge_token": challenge, "method": "totp", "code": current_code},
        )
        assert replayed_challenge.status_code == 401
        assert replayed_challenge.json()["code"] == "AUTH_MFA_CHALLENGE_INVALID"

        status_response = await totp_client.get("/api/v1/auth/totp")
        assert status_response.status_code == 200
        assert status_response.json() == {"enabled": True, "recovery_codes_remaining": 10}

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as recovery_client:
        password = await recovery_client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Recovery browser",
            },
        )
        challenge = password.json()["challenge_token"]
        recovered = await recovery_client.post(
            "/api/v1/auth/totp/login/verify",
            json={
                "challenge_token": challenge,
                "method": "recovery_code",
                "code": recovery_codes[0],
            },
        )
        assert recovered.status_code == 200, recovered.text
        status_response = await recovery_client.get("/api/v1/auth/totp")
        assert status_response.json()["recovery_codes_remaining"] == 9

        replay_password = await recovery_client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Recovery replay browser",
            },
        )
        replayed_recovery = await recovery_client.post(
            "/api/v1/auth/totp/login/verify",
            json={
                "challenge_token": replay_password.json()["challenge_token"],
                "method": "recovery_code",
                "code": recovery_codes[0],
            },
        )
        assert replayed_recovery.status_code == 401
        assert replayed_recovery.json()["code"] == "AUTH_MFA_INVALID"

        csrf = recovery_client.cookies["logion_csrf"]
        next_step_code = pyotp.TOTP(secret).at(int(time.time()) + 30)
        regenerated = await recovery_client.post(
            "/api/v1/auth/totp/recovery-codes/regenerate",
            headers={"X-CSRF-Token": csrf},
            json={"code": next_step_code},
        )
        assert regenerated.status_code == 200, regenerated.text
        assert regenerated.headers["cache-control"] == "no-store"
        assert len(regenerated.json()["recovery_codes"]) == 10

    disable_email = f"totp-disable-{uuid4()}@example.com"
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as disable_client:
        disable_secret, _ = await _register_and_enable_totp(
            disable_client,
            email=disable_email,
            device_name="Disable browser",
        )
        csrf = disable_client.cookies["logion_csrf"]
        disabled = await disable_client.request(
            "DELETE",
            "/api/v1/auth/totp",
            headers={"X-CSRF-Token": csrf},
            json={"code": pyotp.TOTP(disable_secret).now()},
        )
        assert disabled.status_code == 200, disabled.text

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url=origin,
        headers=headers,
    ) as password_only_client:
        password_only = await password_only_client.post(
            "/api/v1/auth/login",
            json={
                "email": disable_email,
                "password": "a-strong-password-123",
                "device_name": "Password browser",
            },
        )
        assert password_only.status_code == 200, password_only.text
        assert "logion_access" in password_only_client.cookies
