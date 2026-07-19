import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.identity.security import IdentitySecurity
from logion_api.main import app
from pydantic import SecretStr, ValidationError


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


def test_production_identity_configuration_requires_secure_cookies() -> None:
    with pytest.raises(ValidationError, match="LOGION_COOKIE_SECURE"):
        Settings(
            env="production",
            secret_key=SecretStr("production-test-secret-key-at-least-32"),
            cookie_secure=False,
            allowed_origins=["https://logion.example"],
        )


def test_production_identity_configuration_accepts_https_origin() -> None:
    settings = Settings(
        env="production",
        secret_key=SecretStr("production-test-secret-key-at-least-32"),
        cookie_secure=True,
        allowed_origins=["https://logion.example"],
    )

    assert settings.cookie_secure is True


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
