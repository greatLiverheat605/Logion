import base64
from uuid import uuid4

import pytest
from logion_api.ai_gateway.crypto import AIProviderCredentialCipher, validate_provider_base_url
from logion_api.ai_gateway.models import AIProvider
from logion_api.ai_gateway.schemas import AIProviderResponse
from logion_api.config import Settings
from logion_api.errors import APIError
from pydantic import SecretStr, ValidationError


@pytest.mark.parametrize(
    "value",
    [
        "http://api.example.com/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.1/v1",
        "https://[::1]/v1",
        "https://service.internal/v1",
        "https://user:password@api.example.com/v1",
        "https://api.example.com:3000/v1",
        "https://api.example.com/v1?token=secret",
        "https://api.example.com/%2e%2e/private",
    ],
)
def test_provider_base_url_blocks_unsafe_targets(value: str) -> None:
    with pytest.raises(ValueError):
        validate_provider_base_url(value)


def test_provider_base_url_normalizes_public_https_endpoint() -> None:
    assert (
        validate_provider_base_url("https://API.Example.com:443/openai/v1/")
        == "https://api.example.com/openai/v1"
    )


def test_provider_credential_uses_aad_bound_envelope_encryption() -> None:
    settings = Settings()
    cipher = AIProviderCredentialCipher(settings)
    workspace_id, provider_id, user_id = uuid4(), uuid4(), uuid4()
    encrypted = cipher.encrypt(workspace_id, provider_id, "provider-secret-value")
    provider = AIProvider(
        id=provider_id,
        workspace_id=workspace_id,
        name="Provider",
        normalized_name="provider",
        provider_type="openai_compatible",
        base_url="https://api.example.com/v1",
        credential_ciphertext=encrypted.credential_ciphertext,
        credential_nonce=encrypted.credential_nonce,
        data_key_ciphertext=encrypted.data_key_ciphertext,
        data_key_nonce=encrypted.data_key_nonce,
        encryption_key_id=encrypted.encryption_key_id,
        enabled=True,
        timeout_seconds=30,
        max_retries=2,
        created_by=user_id,
        updated_by=user_id,
    )
    assert b"provider-secret-value" not in encrypted.credential_ciphertext
    assert cipher.decrypt(provider) == "provider-secret-value"
    provider.workspace_id = uuid4()
    with pytest.raises(APIError) as raised:
        cipher.decrypt(provider)
    assert raised.value.code == "AI_PROVIDER_KEY_UNAVAILABLE"


def test_ai_encryption_key_is_validated_and_replaced_in_production() -> None:
    with pytest.raises(ValidationError, match="must decode to 32 bytes"):
        Settings(
            ai_credential_active_encryption_key_id="bad-v1",
            ai_credential_encryption_keys={"bad-v1": SecretStr("c2hvcnQ")},
        )
    encoded = base64.urlsafe_b64encode(b"a" * 32).decode().rstrip("=")
    with pytest.raises(ValidationError, match="AI_CREDENTIAL_ENCRYPTION_KEYS"):
        Settings(
            env="production",
            secret_key=SecretStr("production-test-secret-key-at-least-32"),
            cookie_secure=True,
            allowed_origins=["https://logion.example"],
            webauthn_rp_id="logion.example",
            webauthn_origins=["https://logion.example"],
            totp_active_encryption_key_id="production-v1",
            totp_encryption_keys={"production-v1": SecretStr(encoded)},
            email_delivery_active_encryption_key_id="production-v1",
            email_delivery_encryption_keys={"production-v1": SecretStr(encoded)},
            ai_credential_active_encryption_key_id="development-v1",
        )


def test_provider_response_schema_has_no_secret_fields() -> None:
    response = AIProviderResponse(
        id=uuid4(),
        workspace_id=uuid4(),
        name="Provider",
        provider_type="openai_compatible",
        base_url="https://api.example.com/v1",
        credential_configured=True,
        enabled=True,
        timeout_seconds=30,
        max_retries=2,
        version=1,
    )
    serialized = response.model_dump()
    assert "credential" not in serialized
    assert all("cipher" not in key and "nonce" not in key for key in serialized)
