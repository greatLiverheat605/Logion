"""Fixed integration hosts, pinned public DNS, verified TLS and bounded streams."""

import asyncio
import ipaddress
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

import httpx

from logion_api.ai_gateway.network import (
    ProviderDnsNotPublic,
    ProviderDnsUnresolvable,
    resolve_public_addresses,
)
from logion_api.config import Settings
from logion_api.errors import APIError

Provider = Literal["zotero", "webdav"]
HOSTS = {"zotero": "api.zotero.org", "webdav": "dav.jianguoyun.com"}


def integration_error(code: str, status: int = 422) -> APIError:
    return APIError(
        code=code,
        message="The integration request could not be completed.",
        status_code=status,
        headers={"Cache-Control": "private, no-store"},
    )


@dataclass(frozen=True)
class IntegrationResponse:
    status: int
    headers: httpx.Headers
    body: bytes


async def request_integration(
    settings: Settings,
    provider: Provider,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
    max_bytes: int = 2 * 1024 * 1024,
    on_bytes: Callable[[int], Awaitable[None]] | None = None,
) -> IntegrationResponse:
    origin = settings.zotero_origin if provider == "zotero" else settings.webdav_origin
    try:
        parsed = urlsplit(origin)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        host = parsed.hostname or ""
    except ValueError as exc:
        raise integration_error("INTEGRATION_HOST_BLOCKED") from exc
    try:
        local_test = settings.env == "test" and ipaddress.ip_address(host).is_loopback
    except ValueError:
        local_test = False
    if (
        parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise integration_error("INTEGRATION_HOST_BLOCKED")
    if not local_test and (parsed.scheme != "https" or host != HOSTS[provider] or port != 443):
        raise integration_error("INTEGRATION_HOST_BLOCKED")
    if local_test and parsed.scheme not in {"http", "https"}:
        raise integration_error("INTEGRATION_HOST_BLOCKED")
    if not path.startswith("/") or path.startswith("//") or "\\" in path or ".." in path.split("/"):
        raise integration_error("INTEGRATION_PATH_BLOCKED")
    if provider == "zotero" and method != "GET":
        raise integration_error("INTEGRATION_READ_ONLY")
    if not local_test:
        try:
            address = str((await resolve_public_addresses(host, port))[0])
        except (ProviderDnsNotPublic, ProviderDnsUnresolvable) as exc:
            raise integration_error("INTEGRATION_DNS_BLOCKED", 503) from exc
    else:
        address = host
    pinned = f"[{address}]" if ":" in address else address
    url = urlunsplit((parsed.scheme, f"{pinned}:{port}", path, "", ""))
    try:
        async with (
            asyncio.timeout(35),
            httpx.AsyncClient(
                timeout=httpx.Timeout(30, connect=10), trust_env=False, follow_redirects=False
            ) as client,
        ):
            request = client.build_request(
                method,
                url,
                headers={**(headers or {}), "Host": parsed.netloc, "Accept-Encoding": "identity"},
                content=content,
            )
            request.extensions["sni_hostname"] = host
            response = await client.send(request, stream=True)
            try:
                if 300 <= response.status_code < 400 and response.status_code != 304:
                    raise integration_error("INTEGRATION_REDIRECT_BLOCKED")
                body = bytearray()
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise integration_error("INTEGRATION_ENCODING_BLOCKED")
                async for chunk in response.aiter_raw(chunk_size=65536):
                    if on_bytes is not None:
                        await on_bytes(len(chunk))
                    if len(body) + len(chunk) > max_bytes:
                        raise integration_error("INTEGRATION_RESPONSE_TOO_LARGE", 413)
                    body.extend(chunk)
                return IntegrationResponse(response.status_code, response.headers, bytes(body))
            finally:
                await response.aclose()
    except (httpx.HTTPError, OSError, TimeoutError) as exc:
        raise integration_error("INTEGRATION_UNAVAILABLE", 503) from exc
