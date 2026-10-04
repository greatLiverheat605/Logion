from http.cookies import SimpleCookie
from uuid import UUID, uuid4

import pyotp
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from httpx import ASGITransport, AsyncClient, Response
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuthSession
from logion_api.identity.security import IdentitySecurity
from logion_api.main import app
from sqlalchemy import select
from test_passkey_integration import _authentication_credential, _registration_credential
from test_totp_integration import _register_and_enable_totp

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def client() -> AsyncClient:
    peer = uuid4().hex
    return AsyncClient(
        transport=ASGITransport(app=app, client=(f"2001:db8::{peer[:4]}:{peer[4:8]}", 55001)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    )


def assert_cookies(response: Response, persistent: bool) -> None:
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    settings = get_settings()
    expected = {
        settings.access_cookie_name: (True, "lax", settings.access_ttl_minutes * 60),
        settings.refresh_cookie_name: (True, "strict", settings.refresh_ttl_days * 86400),
        settings.csrf_cookie_name: (False, "strict", settings.refresh_ttl_days * 86400),
        settings.device_cookie_name: (True, "lax", settings.refresh_ttl_days * 86400),
    }
    cookies: SimpleCookie = SimpleCookie()
    for header in response.headers.get_list("set-cookie"):
        cookies.load(header)
    assert set(cookies) == set(expected)
    for name, (httponly, samesite, max_age) in expected.items():
        cookie = cookies[name]
        assert bool(cookie["httponly"]) is httponly
        assert bool(cookie["secure"]) is settings.cookie_secure
        assert cookie["samesite"] == samesite and cookie["path"] == "/"
        assert cookie["max-age"] == (str(max_age) if persistent else "")
        assert not cookie["expires"]


async def assert_refresh(browser: AsyncClient, persistent: bool) -> None:
    security = IdentitySecurity(get_settings().secret_key.get_secret_value())
    async with session_factory() as db:
        session = await db.scalar(
            select(AuthSession).where(
                AuthSession.access_token_hash
                == security.token_hash(browser.cookies["logion_access"])
            )
        )
        assert session is not None and session.keep_signed_in is persistent
        identifier, expiry = session.id, session.refresh_expires_at
    refreshed = await browser.post(
        "/api/v1/auth/refresh", headers={"X-CSRF-Token": browser.cookies["logion_csrf"]}
    )
    assert_cookies(refreshed, persistent)
    async with session_factory() as db:
        session = await db.get(AuthSession, identifier)
        assert session is not None and session.keep_signed_in is persistent
        assert session.refresh_expires_at == expiry


@pytest.mark.parametrize("choice", [None, False, True])
async def test_password_login_and_refresh_preserve_choice_and_legacy_default(choice):
    payload = {
        "email": f"persistence-{uuid4()}@example.com",
        "password": "synthetic-strong-password-123",
        "device_name": "Synthetic browser",
    }
    async with client() as browser:
        registered = await browser.post("/api/v1/auth/register", json=payload)
        assert registered.status_code == 201, registered.text
        if choice is not None:
            payload["keep_signed_in"] = choice
        logged_in = await browser.post("/api/v1/auth/login", json=payload)
        assert_cookies(logged_in, choice is not False)
        await assert_refresh(browser, choice is not False)


@pytest.mark.parametrize("choice", [False, True])
@pytest.mark.parametrize("method", ["totp", "recovery_code"])
async def test_mfa_carries_password_stage_choice_into_session_and_refresh(choice, method):
    email = f"mfa-persistence-{uuid4()}@example.com"
    async with client() as browser:
        secret, codes = await _register_and_enable_totp(
            browser, email=email, device_name="Synthetic MFA browser"
        )
        browser.cookies.clear()
        password = await browser.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "a-strong-password-123",
                "device_name": "Synthetic MFA browser",
                "keep_signed_in": choice,
            },
        )
        assert password.status_code == 202, password.text
        assert "set-cookie" not in password.headers
        verified = await browser.post(
            "/api/v1/auth/totp/login/verify",
            json={
                "challenge_token": password.json()["challenge_token"],
                "method": method,
                "code": pyotp.TOTP(secret).now() if method == "totp" else codes[0],
                "keep_signed_in": not choice,
            },
        )
        assert_cookies(verified, choice)
        await assert_refresh(browser, choice)


@pytest.mark.parametrize("choice", [False, True])
async def test_passkey_login_and_refresh_preserve_choice(choice):
    private_key = ec.generate_private_key(ec.SECP256R1())
    credential_id = uuid4().bytes + uuid4().bytes
    async with client() as browser:
        registered = await browser.post(
            "/api/v1/auth/register",
            json={
                "email": f"passkey-persistence-{uuid4()}@example.com",
                "password": "synthetic-strong-password-123",
                "device_name": "Synthetic passkey browser",
            },
        )
        assert registered.status_code == 201, registered.text
        user_id = UUID(registered.json()["user"]["id"])
        csrf = {"X-CSRF-Token": browser.cookies["logion_csrf"]}
        options = await browser.post("/api/v1/auth/passkeys/register/options", headers=csrf)
        assert options.status_code == 200, options.text
        public_key = options.json()["public_key"]
        registered_key = await browser.post(
            "/api/v1/auth/passkeys/register/verify",
            headers=csrf,
            json={
                "challenge_id": options.json()["challenge_id"],
                "name": "Synthetic passkey",
                "credential": _registration_credential(
                    private_key,
                    credential_id,
                    rp_id=public_key["rp"]["id"],
                    origin="http://test",
                    challenge=public_key["challenge"],
                ),
            },
        )
        assert registered_key.status_code == 201, registered_key.text
        browser.cookies.clear()
        options = await browser.post("/api/v1/auth/passkeys/login/options")
        assert options.status_code == 200, options.text
        public_key = options.json()["public_key"]
        verified = await browser.post(
            "/api/v1/auth/passkeys/login/verify",
            json={
                "challenge_id": options.json()["challenge_id"],
                "device_name": "Synthetic passkey browser",
                "keep_signed_in": choice,
                "credential": _authentication_credential(
                    private_key,
                    credential_id,
                    user_id,
                    rp_id=public_key["rpId"],
                    origin="http://test",
                    challenge=public_key["challenge"],
                    sign_count=1,
                ),
            },
        )
        assert_cookies(verified, choice)
        await assert_refresh(browser, choice)
