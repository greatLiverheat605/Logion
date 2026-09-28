"""Real API/Worker with an in-process synthetic AI transport for browser tests.

Only this test launcher injects the adapter. Production runtime/network/TLS policies
are unchanged; the transport has no socket access and never records credentials.
"""

import asyncio
import json
import sys
from unittest.mock import patch

import httpx
import uvicorn
from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
from logion_api.ai_gateway.dependencies import get_ai_discovery_adapter
from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.config import get_settings


async def resolve(_hostname: str, _port: int) -> list[str]:
    return ["93.184.216.34"]


def synthetic_provider(request: httpx.Request) -> httpx.Response:
    assert request.headers["Host"] == "api.example.com"
    assert "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND" not in request.content.decode()
    if request.method == "GET" and request.url.path == "/v1/models":
        return httpx.Response(
            200, json={"data": [{"id": "synthetic-economical"}, {"id": "synthetic-quality"}]}
        )
    assert request.method == "POST" and request.url.path == "/v1/chat/completions"
    body = json.loads(request.content)
    content = json.loads(body["messages"][1]["content"])
    output = {
        field: "Synthetic translated passage"
        if body["model"] == "synthetic-economical"
        else "Synthetic explanation"
        for field in content["requested_output_fields"]
    }
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": json.dumps(output)}}],
            "usage": {"prompt_tokens": 30, "completion_tokens": 10},
        },
    )


def transport() -> httpx.MockTransport:
    return httpx.MockTransport(synthetic_provider)


if __name__ == "__main__":
    if get_settings().env != "test":
        raise SystemExit("Synthetic runtime requires LOGION_ENV=test")
    if sys.argv[1] == "api":
        from logion_api.main import app

        app.dependency_overrides[get_ai_discovery_adapter] = lambda: (
            OpenAICompatibleDiscoveryAdapter(resolver=resolve, transport_factory=transport)
        )
        uvicorn.run(app, host="127.0.0.1", port=int(sys.argv[2]), access_log=False)
    elif sys.argv[1] == "worker":
        import logion_worker.main as worker_main

        with patch.object(
            worker_main,
            "AIExecutionService",
            lambda settings: AIExecutionService(
                settings,
                adapter_factory=lambda: OpenAICompatibleGenerationAdapter(
                    resolver=resolve, transport_factory=transport
                ),
            ),
        ):
            asyncio.run(worker_main.run_worker())
    else:
        raise SystemExit("Unknown synthetic runtime mode")
