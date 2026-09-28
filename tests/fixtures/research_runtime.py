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
    assert "PRIVATE_QUESTION_IDEA_SENTINEL" not in request.content.decode()
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
    if content["requested_output_fields"] == ["questions"]:
        output = {
            "questions": json.dumps(
                [
                    {
                        "prompt": f"Explain reading angle {i + 1}.",
                        "answer_key": f"Synthetic reference {i + 1}",
                        "explanation": "Evidence from [source_1].",
                        "concept": f"Reading concept {i + 1}",
                    }
                    for i in range(5)
                ]
            )
        }
    elif content["requested_output_fields"] == ["links"]:
        sources = {key: json.loads(value) for key, value in content["data"].items()}
        assert all(value["entity_type"] != "research_idea" for value in sources.values())
        questions = [
            key for key, value in sources.items() if value["entity_type"] == "research_question"
        ]
        papers = [key for key, value in sources.items() if value["entity_type"] == "resource"]
        output = {
            "links": json.dumps(
                [
                    {
                        "from_source": paper,
                        "to_source": questions[0],
                        "relation": "addresses",
                        "reason": "Synthetic evidence addresses the selected research question.",
                    }
                    for paper in papers
                    if questions
                ]
            )
        }
    elif content["requested_output_fields"] == ["comment"]:
        from logion_api.planning.weekly_schemas import WeeklyStats

        assert set(content["data"]) == {"statistics"}
        stats = json.loads(content["data"]["statistics"])
        WeeklyStats.model_validate(stats)
        assert all(type(value) is int for value in stats.values())
        output = {"comment": "本周阅读节奏清晰，请逐项安排未完成任务。"}
    elif content["requested_output_fields"] == ["grade"]:
        assert "quiz_attempt" in json.dumps(content)
        output = {
            "grade": json.dumps(
                {
                    "score": 80,
                    "reasoning": "The answer identifies the motivation [source_1].",
                    "weak_concepts": ["Experimental limits"],
                }
            )
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
        from starlette.types import ASGIApp, Message, Receive, Scope, Send

        class ProductionConnectionPolicy:
            """Match Nginx's close policy for HTTP upstreams, retaining WebSockets."""

            def __init__(self, wrapped: ASGIApp) -> None:
                self.wrapped = wrapped

            async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
                async def response(message: Message) -> None:
                    if message["type"] == "http.response.start":
                        message = {
                            **message,
                            "headers": [*message.get("headers", []), (b"connection", b"close")],
                        }
                    await send(message)

                await self.wrapped(scope, receive, response)

        app.dependency_overrides[get_ai_discovery_adapter] = lambda: (
            OpenAICompatibleDiscoveryAdapter(resolver=resolve, transport_factory=transport)
        )
        uvicorn.run(
            ProductionConnectionPolicy(app),
            host="127.0.0.1",
            port=int(sys.argv[2]),
            access_log=False,
        )
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
