import asyncio
import base64
from uuid import uuid4

import httpx
import pytest
from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
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
        last_health_status="unknown",
        last_health_checked_at=None,
        last_health_error_code=None,
        version=1,
    )
    serialized = response.model_dump()
    assert "credential" not in serialized
    assert all("cipher" not in key and "nonce" not in key for key in serialized)


@pytest.mark.asyncio
async def test_discovery_pins_public_ip_and_preserves_host_and_sni() -> None:
    async def resolver(hostname: str, port: int) -> list[str]:
        assert (hostname, port) == ("api.example.com", 443)
        return ["93.184.216.34"]

    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://93.184.216.34/v1/models"
        assert request.headers["host"] == "api.example.com"
        assert request.extensions["sni_hostname"] == b"api.example.com"
        assert request.headers["authorization"] == "Bearer provider-test-secret"
        return httpx.Response(200, json={"data": [{"id": "model-a"}]})

    adapter = OpenAICompatibleDiscoveryAdapter(
        resolver=resolver,
        transport_factory=lambda: httpx.MockTransport(handler),
    )
    rows = await adapter.discover(
        base_url="https://api.example.com/v1",
        credential="provider-test-secret",
        timeout_seconds=30,
    )
    assert [row.provider_model_id for row in rows] == ["model-a"]


@pytest.mark.asyncio
@pytest.mark.parametrize("addresses", [["127.0.0.1"], ["93.184.216.34", "10.0.0.2"]])
async def test_discovery_rejects_non_public_or_mixed_dns(addresses: list[str]) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return addresses

    adapter = OpenAICompatibleDiscoveryAdapter(resolver=resolver)
    with pytest.raises(APIError) as raised:
        await adapter.discover(
            base_url="https://api.example.com/v1",
            credential="provider-test-secret",
            timeout_seconds=30,
        )
    assert raised.value.code == "AI_PROVIDER_DNS_BLOCKED"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (302, "AI_PROVIDER_REDIRECT_BLOCKED"),
        (401, "AI_PROVIDER_AUTH_FAILED"),
        (429, "AI_PROVIDER_RATE_LIMITED"),
        (503, "AI_PROVIDER_UNAVAILABLE"),
    ],
)
async def test_discovery_normalizes_provider_status(status: int, expected: str) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["93.184.216.34"]

    adapter = OpenAICompatibleDiscoveryAdapter(
        resolver=resolver,
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(status, text="sensitive upstream details")
        ),
    )
    with pytest.raises(APIError) as raised:
        await adapter.discover(
            base_url="https://api.example.com/v1",
            credential="provider-test-secret",
            timeout_seconds=30,
        )
    assert raised.value.code == expected
    assert "sensitive" not in str(raised.value)
    assert "provider-test-secret" not in str(raised.value)


@pytest.mark.asyncio
async def test_discovery_enforces_response_and_model_bounds() -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["93.184.216.34"]

    oversized = OpenAICompatibleDiscoveryAdapter(
        resolver=resolver,
        max_response_bytes=16,
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                content=b"{" + b"x" * 32 + b"}",
                headers={"Content-Type": "application/json"},
            )
        ),
    )
    with pytest.raises(APIError) as raised:
        await oversized.discover(
            base_url="https://api.example.com/v1",
            credential="provider-test-secret",
            timeout_seconds=30,
        )
    assert raised.value.code == "AI_PROVIDER_RESPONSE_TOO_LARGE"

    invalid_model = OpenAICompatibleDiscoveryAdapter(
        resolver=resolver,
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"data": [{"id": "x" * 256}]})
        ),
    )
    with pytest.raises(APIError) as invalid:
        await invalid_model.discover(
            base_url="https://api.example.com/v1",
            credential="provider-test-secret",
            timeout_seconds=30,
        )
    assert invalid.value.code == "AI_PROVIDER_RESPONSE_INVALID"


@pytest.mark.asyncio
async def test_discovery_does_not_swallow_cancellation() -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["93.184.216.34"]

    async def cancelled(_request: httpx.Request) -> httpx.Response:
        raise asyncio.CancelledError

    adapter = OpenAICompatibleDiscoveryAdapter(
        resolver=resolver,
        transport_factory=lambda: httpx.MockTransport(cancelled),
    )
    with pytest.raises(asyncio.CancelledError):
        await adapter.discover(
            base_url="https://api.example.com/v1",
            credential="provider-test-secret",
            timeout_seconds=30,
        )
