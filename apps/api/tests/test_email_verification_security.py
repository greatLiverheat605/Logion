import base64
from uuid import uuid4

import pytest
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import EmailOutbox, IdentityActionToken, User
from logion_api.identity.passkeys import _authentication_credential_statement
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import require_verified_email
from logion_api.identity.verification_routes import _enforce_registration_rate_limits
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


def _production_settings(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "env": "production",
        "secret_key": SecretStr("production-test-secret-key-at-least-32"),
        "cookie_secure": True,
        "allowed_origins": ["https://logion.example"],
        "webauthn_rp_id": "logion.example",
        "webauthn_origins": ["https://logion.example"],
        "totp_active_encryption_key_id": "production-v1",
        "totp_encryption_keys": {
            "production-v1": SecretStr(base64.urlsafe_b64encode(b"t" * 32).decode())
        },
        "email_delivery_active_encryption_key_id": "production-v1",
        "email_delivery_encryption_keys": {
            "production-v1": SecretStr(base64.urlsafe_b64encode(b"e" * 32).decode())
        },
        "legacy_registration_enabled": False,
    }
    values.update(overrides)
    return values


def test_production_rejects_development_email_key_and_legacy_registration() -> None:
    with pytest.raises(ValidationError, match="EMAIL_DELIVERY_ENCRYPTION_KEYS"):
        Settings(
            **_production_settings(
                email_delivery_active_encryption_key_id="development-v1",
                email_delivery_encryption_keys={
                    "development-v1": SecretStr(
                        base64.urlsafe_b64encode(b"e" * 32).decode()
                    )
                },
            )
        )
    with pytest.raises(ValidationError, match="LEGACY_REGISTRATION_ENABLED"):
        Settings(**_production_settings(legacy_registration_enabled=True))


def test_identity_action_token_is_high_entropy_and_purpose_bound() -> None:
    security = IdentitySecurity("email-verification-test-secret-at-least-32")
    token = security.new_identity_action_token()
    decoded = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))

    assert len(decoded) == 48
    assert security.identity_action_token_hash("email_verification", token) != security.token_hash(
        token
    )
    assert security.identity_action_token_hash(
        "email_verification", token
    ) != security.identity_action_token_hash("password_recovery", token)


def test_email_outbox_payload_is_encrypted_and_aad_bound() -> None:
    settings = Settings()
    cipher = EmailDeliveryCipher(settings)
    outbox_id = uuid4()
    user_id = uuid4()
    payload = {"recipient": "person@example.com", "token": "sensitive-token"}
    encrypted = cipher.encrypt(
        outbox_id=outbox_id,
        user_id=user_id,
        purpose="email_verification",
        payload=payload,
    )
    outbox = EmailOutbox(
        id=outbox_id,
        user_id=user_id,
        purpose="email_verification",
        encryption_key_id=encrypted.key_id,
        payload_ciphertext=encrypted.ciphertext,
        payload_nonce=encrypted.nonce,
    )

    assert b"person@example.com" not in outbox.payload_ciphertext
    assert b"sensitive-token" not in outbox.payload_ciphertext
    assert cipher.decrypt(outbox) == payload

    outbox.user_id = uuid4()
    with pytest.raises(APIError, match="Email delivery is temporarily unavailable"):
        cipher.decrypt(outbox)


@pytest.mark.asyncio
async def test_registration_rate_limits_ip_and_account_independently() -> None:
    limiter = RecordingRateLimiter()
    settings = Settings(
        email_registration_ip_limit_per_hour=9,
        email_registration_account_limit_per_hour=3,
    )

    await _enforce_registration_rate_limits(
        limiter,  # type: ignore[arg-type]
        settings,
        client_ip_value="192.0.2.10",
        normalized_email="person@example.com",
    )

    assert [call["scope"] for call in limiter.calls] == [
        "email_registration_ip",
        "email_registration_account",
    ]
    assert [call["limit"] for call in limiter.calls] == [9, 3]
    assert all(call["window"] == 3600 for call in limiter.calls)
    assert limiter.calls[0]["subject_hash"] != limiter.calls[1]["subject_hash"]


def test_email_verification_contract_is_additive_and_token_is_not_in_path() -> None:
    openapi = app.openapi()
    start = openapi["paths"]["/api/v1/auth/registrations"]["post"]
    confirmation = openapi["paths"][
        "/api/v1/auth/email-verification/confirmations"
    ]["post"]

    assert "202" in start["responses"]
    assert "token" not in "/api/v1/auth/email-verification/confirmations"
    assert confirmation["requestBody"]["required"] is True
    assert "410" in openapi["paths"]["/api/v1/auth/register"]["post"]["responses"]


def test_email_verification_tables_have_delivery_and_active_indexes() -> None:
    action_indexes = {index.name for index in IdentityActionToken.__table__.indexes}
    outbox_indexes = {index.name for index in EmailOutbox.__table__.indexes}

    assert "ix_identity_action_tokens_user_purpose_active" in action_indexes
    assert "ix_identity_action_tokens_expiry" in action_indexes
    assert "ix_email_outbox_delivery" in outbox_indexes


def test_unverified_accounts_cannot_enroll_or_authenticate_with_passkeys() -> None:
    user = User(email="unverified@example.com", email_normalized="unverified@example.com")
    with pytest.raises(APIError) as raised:
        require_verified_email(user)
    assert raised.value.code == "AUTH_EMAIL_VERIFICATION_REQUIRED"

    statement = str(
        _authentication_credential_statement(b"credential-id").compile(
            dialect=postgresql.dialect()
        )
    )
    assert "users.email_verified_at IS NOT NULL" in statement
