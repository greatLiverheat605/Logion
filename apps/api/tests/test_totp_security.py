import base64
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.models import TotpCredential
from logion_api.identity.schemas import MfaLoginVerifyRequest
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.totp import TotpSecretCipher
from logion_api.main import app
from pydantic import SecretStr, ValidationError


def _encoded_key(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def test_totp_secret_uses_envelope_encryption_and_authenticated_context() -> None:
    settings = Settings(
        totp_active_encryption_key_id="test-v1",
        totp_encryption_keys={"test-v1": _encoded_key(b"k" * 32)},
    )
    user_id = uuid4()
    totp_seed = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
    encrypted = TotpSecretCipher(settings).encrypt(user_id, totp_seed)
    credential = TotpCredential(
        user_id=user_id,
        secret_ciphertext=encrypted.secret_ciphertext,
        secret_nonce=encrypted.secret_nonce,
        data_key_ciphertext=encrypted.data_key_ciphertext,
        data_key_nonce=encrypted.data_key_nonce,
        encryption_key_id=encrypted.encryption_key_id,
        pending_expires_at=datetime.now(UTC) + timedelta(minutes=10),
    )

    assert totp_seed.encode() not in credential.secret_ciphertext
    assert TotpSecretCipher(settings).decrypt(credential) == totp_seed

    credential.secret_ciphertext = credential.secret_ciphertext[:-1] + bytes(
        [credential.secret_ciphertext[-1] ^ 1]
    )
    with pytest.raises(APIError) as raised:
        TotpSecretCipher(settings).decrypt(credential)
    assert raised.value.code == "AUTH_TOTP_KEY_UNAVAILABLE"


def test_totp_encryption_key_must_be_32_bytes_and_replaced_in_production() -> None:
    with pytest.raises(ValidationError, match="must decode to 32 bytes"):
        Settings(
            totp_active_encryption_key_id="bad-v1",
            totp_encryption_keys={"bad-v1": _encoded_key(b"short")},
        )

    with pytest.raises(ValidationError, match="must be replaced in production"):
        Settings(
            env="production",
            secret_key=SecretStr("production-test-secret-key-at-least-32"),
            cookie_secure=True,
            allowed_origins=["https://logion.example"],
            webauthn_rp_id="logion.example",
            webauthn_origins=["https://logion.example"],
        )


def test_recovery_codes_are_normalized_slow_hashed_and_not_reusable_as_other_codes() -> None:
    security = IdentitySecurity("phase1-unit-test-secret-key-32-bytes")
    code = security.new_recovery_code()
    another = security.new_recovery_code()
    code_hash = security.hash_recovery_code(code)

    assert len(code.split("-")) == 4
    assert all(len(group) == 4 for group in code.split("-"))
    assert code not in code_hash
    assert security.verify_recovery_code(code_hash, code.lower().replace("-", ""))
    assert not security.verify_recovery_code(code_hash, another)
    assert security.recovery_code_lookup_hash(code) != security.recovery_code_lookup_hash(another)


def test_mfa_request_enforces_method_specific_code_shape() -> None:
    with pytest.raises(ValidationError):
        MfaLoginVerifyRequest(
            challenge_token="x" * 48,
            method="totp",
            code="12345a",
        )
    with pytest.raises(ValidationError):
        MfaLoginVerifyRequest(
            challenge_token="x" * 48,
            method="recovery_code",
            code="too-short",
        )


@pytest.mark.asyncio
async def test_mfa_validation_error_does_not_echo_recovery_code() -> None:
    sensitive_code = "LEAK-ME-NOT-12345"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/auth/totp/login/verify",
            headers={"Origin": "http://localhost:3000"},
            json={
                "challenge_token": "x" * 48,
                "method": "recovery_code",
                "code": sensitive_code,
            },
        )

    assert response.status_code == 422
    assert sensitive_code not in response.text
