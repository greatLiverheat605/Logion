from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.models import AuthSession, Device, User
from logion_api.identity.passkeys import _authentication_credential_statement
from logion_api.identity.routes import _enforce_login_rate_limits
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, IdentityService
from logion_api.main import app
from pydantic import SecretStr, ValidationError
from sqlalchemy.dialects import postgresql


class RecordingRateLimiter:
    def __init__(self) -> None:
        self.calls: list[dict[str, str | int]] = []

    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None:
        self.calls.append(
            {
                "scope": scope,
                "subject_hash": subject_hash,
                "limit": limit,
                "window": window,
            }
        )


def test_password_hash_is_argon2_and_verifies() -> None:
    security = IdentitySecurity("phase1-unit-test-secret-key-32-bytes")
    password_hash = security.hash_password("a-strong-password-123")

    assert password_hash.startswith("$argon2id$")
    assert security.verify_password(password_hash, "a-strong-password-123")
    assert not security.verify_password(password_hash, "wrong-password")


def test_token_hash_is_keyed_and_stable() -> None:
    security = IdentitySecurity("phase1-unit-test-secret-key-32-bytes")

    assert security.token_hash("token") == security.token_hash("token")
    another_security = IdentitySecurity("another-secret-key-32-bytes")
    assert security.token_hash("token") != another_security.token_hash("token")


def test_passkey_authentication_locks_credential_counter() -> None:
    statement = _authentication_credential_statement(b"credential-id")
    compiled = str(statement.compile(dialect=postgresql.dialect()))

    assert "FOR UPDATE OF passkey_credentials" in compiled


@pytest.mark.asyncio
async def test_login_rate_limits_ip_and_account_independently() -> None:
    limiter = RecordingRateLimiter()
    settings = Settings(
        login_ip_limit_per_five_minutes=17,
        login_account_limit_per_five_minutes=7,
    )

    await _enforce_login_rate_limits(
        limiter,
        settings,
        client_ip_value="203.0.113.10",
        normalized_email="user@example.com",
    )

    assert [call["scope"] for call in limiter.calls] == ["login_ip", "login_account"]
    assert [call["limit"] for call in limiter.calls] == [17, 7]
    assert all(call["window"] == 300 for call in limiter.calls)
    assert limiter.calls[0]["subject_hash"] != limiter.calls[1]["subject_hash"]


@pytest.mark.asyncio
async def test_changing_email_does_not_change_login_ip_bucket() -> None:
    limiter = RecordingRateLimiter()
    settings = Settings()

    for email in ("first@example.com", "second@example.com"):
        await _enforce_login_rate_limits(
            limiter,
            settings,
            client_ip_value="203.0.113.10",
            normalized_email=email,
        )

    ip_calls = [call for call in limiter.calls if call["scope"] == "login_ip"]
    account_calls = [call for call in limiter.calls if call["scope"] == "login_account"]
    assert ip_calls[0]["subject_hash"] == ip_calls[1]["subject_hash"]
    assert account_calls[0]["subject_hash"] != account_calls[1]["subject_hash"]


def test_production_identity_configuration_requires_secure_cookies() -> None:
    with pytest.raises(ValidationError, match="LOGION_COOKIE_SECURE"):
        Settings(
            env="production",
            secret_key=SecretStr("production-test-secret-key-at-least-32"),
            cookie_secure=False,
            allowed_origins=["https://logion.example"],
            webauthn_rp_id="logion.example",
            webauthn_origins=["https://logion.example"],
        )


def test_production_identity_configuration_accepts_https_origin() -> None:
    settings = Settings(
        env="production",
        secret_key=SecretStr("production-test-secret-key-at-least-32"),
        cookie_secure=True,
        allowed_origins=["https://logion.example"],
        webauthn_rp_id="logion.example",
        webauthn_origins=["https://logion.example"],
    )

    assert settings.cookie_secure is True


def test_webauthn_rp_id_must_match_every_origin() -> None:
    with pytest.raises(ValidationError, match="LOGION_WEBAUTHN_RP_ID"):
        Settings(
            allowed_origins=["https://login.example.com"],
            webauthn_rp_id="other.example.com",
            webauthn_origins=["https://login.example.com"],
        )


def test_changing_authentication_methods_requires_recent_login() -> None:
    settings = Settings(recent_auth_ttl_seconds=600)
    service = IdentityService(settings, IdentitySecurity(settings.secret_key.get_secret_value()))
    context = AuthContext(
        user=User(email="user@example.com", email_normalized="user@example.com"),
        device=Device(user_id=uuid4(), name="Browser"),
        session=AuthSession(created_at=datetime.now(UTC) - timedelta(minutes=11)),
    )

    with pytest.raises(APIError) as raised:
        service.require_recent_authentication(context)

    assert raised.value.code == "AUTH_RECENT_LOGIN_REQUIRED"


@pytest.mark.asyncio
async def test_passkey_options_require_explicit_origin() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/passkeys/login/options")

    assert response.status_code == 403
    assert response.json()["code"] == "AUTH_ORIGIN_INVALID"


@pytest.mark.asyncio
async def test_passkey_validation_error_does_not_echo_signature() -> None:
    sensitive_signature = "sensitive-passkey-signature"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/passkeys/login/verify",
            headers={"Origin": "http://localhost:3000"},
            json={
                "challenge_id": str(uuid4()),
                "device_name": "",
                "credential": {
                    "id": "credential",
                    "rawId": "credential",
                    "type": "public-key",
                    "clientExtensionResults": {},
                    "response": {
                        "clientDataJSON": "client-data",
                        "authenticatorData": "authenticator-data",
                        "signature": sensitive_signature,
                    },
                },
            },
        )

    assert response.status_code == 422
    assert sensitive_signature not in response.text


@pytest.mark.asyncio
async def test_validation_error_does_not_echo_password() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/register",
            headers={"Origin": "http://localhost:3000"},
            json={
                "email": "valid@example.com",
                "password": "secret",
                "device_name": "Test browser",
            },
        )

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert "secret" not in response.text
    assert all("input" not in error for error in response.json()["details"]["errors"])


def test_identity_openapi_uses_sanitized_error_contract() -> None:
    schema = app.openapi()
    register_responses = schema["paths"]["/api/v1/auth/register"]["post"]["responses"]

    assert register_responses["422"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorResponse"
    }
