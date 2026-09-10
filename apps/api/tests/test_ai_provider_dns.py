import asyncio
import json
import re
from unittest.mock import Mock

import pytest
from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.network import Resolver, resolve_public_addresses
from logion_api.errors import APIError, api_error_handler
from starlette.requests import Request

IPV4 = re.compile(r"(?:\d{1,3}\.){3}\d{1,3}")
IPV6 = re.compile(r"(?:[0-9a-fA-F]{0,4}:){2,}[0-9a-fA-F:.]*")


@pytest.fixture(params=["discovery", "generation"])
def operation(request: pytest.FixtureRequest) -> str:
    return str(request.param)


async def invoke(
    operation: str, resolver: Resolver, base_url: str = "https://api.example.com/v1"
) -> None:
    transport_factory = Mock(side_effect=AssertionError("DNS failure must precede HTTP"))
    try:
        if operation == "discovery":
            await OpenAICompatibleDiscoveryAdapter(
                resolver=resolver, transport_factory=transport_factory
            ).discover(base_url=base_url, credential="test-only", timeout_seconds=30)
        else:

            async def not_cancelled() -> bool:
                return False

            await OpenAICompatibleGenerationAdapter(
                resolver=resolver, transport_factory=transport_factory
            ).generate(
                base_url=base_url,
                credential="test-only",
                timeout_seconds=30,
                provider_model_id="model-a",
                input_fields={"note": "test"},
                expected_output_fields=["summary"],
                max_output_tokens=100,
                cancelled=not_cancelled,
            )
    finally:
        transport_factory.assert_not_called()


async def assert_dns_error(
    error: APIError, *, blocked: bool, count: int, hostname: str | None = "api.example.com"
) -> None:
    assert error.code == ("AI_PROVIDER_DNS_BLOCKED" if blocked else "AI_PROVIDER_DNS_UNRESOLVABLE")
    assert error.status_code == (422 if blocked else 503)
    assert error.retryable is not blocked
    assert error.details == {"hostname": hostname, "resolved_count": count}
    serialized = json.dumps(error.details)
    assert IPV4.search(serialized) is None
    assert IPV6.search(serialized) is None
    response = await api_error_handler(Request({"type": "http", "path": "/", "headers": []}), error)
    payload = json.loads(response.body)
    assert payload["details"] == error.details
    assert payload["code"] == error.code
    assert payload["retryable"] == error.retryable
    assert response.status_code == error.status_code
    assert "resolver-sensitive" not in response.body.decode()


@pytest.mark.parametrize("failure", ["oserror", "unicode", "value", "empty", "invalid"])
async def test_dns_unresolvable_is_retryable_without_addresses(
    operation: str, failure: str
) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        message = "resolver-sensitive 10.0.0.2 fd00::1"
        if failure == "oserror":
            raise OSError(message)
        if failure == "unicode":
            raise UnicodeError(message)
        if failure == "value":
            raise ValueError(message)
        return [] if failure == "empty" else ["invalid-address"]

    with pytest.raises(APIError) as raised:
        await invoke(operation, resolver)
    await assert_dns_error(raised.value, blocked=False, count=0)


@pytest.mark.parametrize(
    "addresses",
    [
        ["127.0.0.1"],
        ["10.0.0.2"],
        ["169.254.169.254"],
        ["0.0.0.0"],  # noqa: S104 - rejected resolver fixture, never a bind address
        ["::1"],
        ["fd00::1"],
        ["fe80::1"],
        ["::ffff:10.0.0.2"],
        ["93.184.216.34", "10.0.0.2"],
        ["2606:4700:4700::1111", "fd00::1"],
        ["93.184.216.34", "::1"],
    ],
)
async def test_dns_non_public_stays_blocked_without_addresses(
    operation: str, addresses: list[str]
) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return addresses

    with pytest.raises(APIError) as raised:
        await invoke(operation, resolver)
    await assert_dns_error(raised.value, blocked=True, count=len(addresses))


@pytest.mark.parametrize(
    "host",
    [
        "93.184.216.34",
        "[2606:4700:4700::1111]",
        "93.184.216.34.",
        "93.184.216.34.example.com",
    ],
)
@pytest.mark.parametrize("blocked", [False, True])
async def test_dns_details_redact_ip_literal_hostname(
    operation: str, host: str, blocked: bool
) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["::1"] if blocked else []

    with pytest.raises(APIError) as raised:
        await invoke(operation, resolver, f"https://{host}/v1")
    await assert_dns_error(raised.value, blocked=blocked, count=int(blocked), hostname=None)


async def test_missing_hostname_is_url_error_without_resolution(operation: str) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        pytest.fail("A hostname-less URL must not invoke DNS")

    with pytest.raises(APIError) as raised:
        await invoke(operation, resolver, "/v1")
    assert raised.value.code == "AI_PROVIDER_URL_BLOCKED"
    assert raised.value.status_code == 422
    assert raised.value.retryable is False
    assert raised.value.details == {}


async def test_dns_cancellation_propagates(operation: str) -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await invoke(operation, resolver)


async def test_public_ipv4_and_ipv6_remain_accepted() -> None:
    async def resolver(_hostname: str, _port: int) -> list[str]:
        return ["93.184.216.34", "2606:4700:4700::1111"]

    addresses = await resolve_public_addresses("api.example.com", 443, resolver)
    assert [str(address) for address in addresses] == await resolver("", 443)
