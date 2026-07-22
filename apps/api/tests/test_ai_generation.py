import json
from uuid import uuid4

import httpx
import pytest
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.models import AIRun
from logion_api.ai_gateway.run_crypto import AIRunInputCipher
from logion_api.config import Settings
from logion_api.errors import APIError


async def public_resolver(_hostname: str, _port: int) -> list[str]:
    return ["93.184.216.34"]


async def not_cancelled() -> bool:
    return False


@pytest.mark.asyncio
async def test_generation_pins_ip_preserves_host_and_validates_structured_output() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://93.184.216.34/v1/chat/completions"
        assert request.headers["host"] == "api.example.com"
        assert request.extensions["sni_hostname"] == b"api.example.com"
        assert request.headers["authorization"] == "Bearer provider-generation-secret"
        body = json.loads(request.content)
        assert body["stream"] is False
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"summary":"draft only"}'}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 5},
            },
        )

    adapter = OpenAICompatibleGenerationAdapter(
        resolver=public_resolver,
        transport_factory=lambda: httpx.MockTransport(handler),
    )
    result = await adapter.generate(
        base_url="https://api.example.com/v1",
        credential="provider-generation-secret",
        provider_model_id="model-a",
        input_fields={"note": "untrusted source text"},
        expected_output_fields=["summary"],
        max_output_tokens=100,
        timeout_seconds=30,
        cancelled=not_cancelled,
    )
    assert result.output == {"summary": "draft only"}
    assert result.input_tokens == 20
    assert result.output_tokens == 5


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status_code", "error_code"),
    [
        (302, "AI_PROVIDER_REDIRECT_BLOCKED"),
        (401, "AI_PROVIDER_AUTH_FAILED"),
        (429, "AI_PROVIDER_RATE_LIMITED"),
        (503, "AI_PROVIDER_UNAVAILABLE"),
    ],
)
async def test_generation_normalizes_errors_without_secret(
    status_code: int, error_code: str
) -> None:
    adapter = OpenAICompatibleGenerationAdapter(
        resolver=public_resolver,
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(status_code, text="raw sensitive provider response")
        ),
    )
    with pytest.raises(APIError) as raised:
        await adapter.generate(
            base_url="https://api.example.com/v1",
            credential="provider-generation-secret",
            provider_model_id="model-a",
            input_fields={"note": "private input"},
            expected_output_fields=["summary"],
            max_output_tokens=100,
            timeout_seconds=30,
            cancelled=not_cancelled,
        )
    assert raised.value.code == error_code
    assert "secret" not in str(raised.value)
    assert "sensitive" not in str(raised.value)


@pytest.mark.asyncio
async def test_generation_rejects_wrong_draft_schema_and_honors_cancellation() -> None:
    adapter = OpenAICompatibleGenerationAdapter(
        resolver=public_resolver,
        transport_factory=lambda: httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"unexpected":"value"}'}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 4},
                },
            )
        ),
    )
    with pytest.raises(APIError) as invalid:
        await adapter.generate(
            base_url="https://api.example.com/v1",
            credential="provider-generation-secret",
            provider_model_id="model-a",
            input_fields={"note": "private input"},
            expected_output_fields=["summary"],
            max_output_tokens=100,
            timeout_seconds=30,
            cancelled=not_cancelled,
        )
    assert invalid.value.code == "AI_DRAFT_SCHEMA_INVALID"

    async def cancelled() -> bool:
        return True

    with pytest.raises(APIError) as stopped:
        await adapter.generate(
            base_url="https://api.example.com/v1",
            credential="provider-generation-secret",
            provider_model_id="model-a",
            input_fields={"note": "private input"},
            expected_output_fields=["summary"],
            max_output_tokens=100,
            timeout_seconds=30,
            cancelled=cancelled,
        )
    assert stopped.value.code == "AI_RUN_CANCELLED"


def test_run_input_is_encrypted_and_bound_to_workspace_and_run() -> None:
    settings = Settings()
    cipher = AIRunInputCipher(settings)
    workspace_id, run_id, user_id, route_id, target_id = (
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
        uuid4(),
    )
    encrypted = cipher.encrypt(workspace_id, run_id, {"note": "private run input"})
    run = AIRun(
        id=run_id,
        workspace_id=workspace_id,
        route_id=route_id,
        task_type="user.summary",
        target_type="note",
        target_id=target_id,
        target_version=1,
        selected_fields=["note"],
        expected_output_fields=["summary"],
        input_ciphertext=encrypted.ciphertext,
        input_nonce=encrypted.nonce,
        input_data_key_ciphertext=encrypted.data_key_ciphertext,
        input_data_key_nonce=encrypted.data_key_nonce,
        input_encryption_key_id=encrypted.encryption_key_id,
        retain_input=False,
        prompt_version="structured-draft-v1",
        prompt_hash="a" * 64,
        idempotency_key=uuid4(),
        request_hash="b" * 64,
        status="queued",
        estimated_input_tokens=10,
        requested_output_tokens=10,
        reserved_tokens=20,
        reserved_cost_minor=1,
        currency="USD",
        requested_by=user_id,
    )
    assert b"private run input" not in encrypted.ciphertext
    assert cipher.decrypt(run) == {"note": "private run input"}
    run.workspace_id = uuid4()
    with pytest.raises(APIError) as raised:
        cipher.decrypt(run)
    assert raised.value.code == "AI_RUN_INPUT_UNAVAILABLE"
