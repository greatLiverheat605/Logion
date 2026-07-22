import json
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import httpx

from logion_api.ai_gateway.network import Resolver, resolve_host, resolve_public_addresses
from logion_api.errors import APIError


@dataclass(frozen=True)
class DiscoveredModel:
    provider_model_id: str
    display_name: str


class OpenAICompatibleDiscoveryAdapter:
    def __init__(
        self,
        *,
        resolver: Resolver = resolve_host,
        transport_factory: Callable[[], httpx.AsyncBaseTransport] | None = None,
        max_response_bytes: int = 1_048_576,
        max_models: int = 1_000,
    ) -> None:
        self._resolver = resolver
        self._transport_factory = transport_factory
        self._max_response_bytes = max_response_bytes
        self._max_models = max_models

    async def discover(
        self,
        *,
        base_url: str,
        credential: str,
        timeout_seconds: int,
    ) -> list[DiscoveredModel]:
        parsed = urlsplit(base_url)
        hostname = parsed.hostname
        if hostname is None:
            raise self._error("AI_PROVIDER_DNS_BLOCKED", 422, False)
        port = parsed.port or 443
        try:
            addresses = await resolve_public_addresses(hostname, port, self._resolver)
        except ValueError as exc:
            raise self._error("AI_PROVIDER_DNS_BLOCKED", 422, False) from exc

        address = str(addresses[0])
        pinned_host = f"[{address}]" if ":" in address else address
        netloc = f"{pinned_host}:{port}" if port != 443 else pinned_host
        models_path = f"{parsed.path.rstrip('/')}/models"
        pinned_url = urlunsplit(("https", netloc, models_path, "", ""))
        original_host = hostname if port == 443 else f"{hostname}:{port}"
        transport = self._transport_factory() if self._transport_factory else None
        timeout = httpx.Timeout(min(timeout_seconds, 30), connect=min(timeout_seconds, 10))

        try:
            async with httpx.AsyncClient(
                follow_redirects=False,
                timeout=timeout,
                transport=transport,
                trust_env=False,
            ) as client:
                request = client.build_request(
                    "GET",
                    pinned_url,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {credential}",
                        "Host": original_host,
                    },
                )
                request.extensions["sni_hostname"] = hostname.encode("ascii")
                response = await client.send(request, stream=True)
                try:
                    self._validate_status(response.status_code)
                    body = await self._bounded_body(response)
                finally:
                    await response.aclose()
        except APIError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.ProtocolError) as exc:
            raise self._error("AI_PROVIDER_UNAVAILABLE", 503, True) from exc

        return self._parse_models(body)

    def _validate_status(self, status_code: int) -> None:
        if 300 <= status_code < 400:
            raise self._error("AI_PROVIDER_REDIRECT_BLOCKED", 422, False)
        if status_code in {401, 403}:
            raise self._error("AI_PROVIDER_AUTH_FAILED", 422, False)
        if status_code == 429:
            raise self._error("AI_PROVIDER_RATE_LIMITED", 503, True)
        if status_code >= 500:
            raise self._error("AI_PROVIDER_UNAVAILABLE", 503, True)
        if status_code < 200 or status_code >= 300:
            raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)

    async def _bounded_body(self, response: httpx.Response) -> bytes:
        content_type = response.headers.get("content-type", "").lower()
        if "application/json" not in content_type:
            raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)
        length = response.headers.get("content-length")
        if length is not None:
            try:
                if int(length) > self._max_response_bytes:
                    raise self._error("AI_PROVIDER_RESPONSE_TOO_LARGE", 422, False)
            except ValueError as exc:
                raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False) from exc
        chunks: list[bytes] = []
        size = 0
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > self._max_response_bytes:
                raise self._error("AI_PROVIDER_RESPONSE_TOO_LARGE", 422, False)
            chunks.append(chunk)
        return b"".join(chunks)

    def _parse_models(self, body: bytes) -> list[DiscoveredModel]:
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False) from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)
        rows = payload["data"]
        if len(rows) > self._max_models:
            raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)
        models: list[DiscoveredModel] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)
            model_id = row.get("id")
            if (
                not isinstance(model_id, str)
                or not model_id.strip()
                or len(model_id) > 255
                or any(ord(character) < 32 for character in model_id)
            ):
                raise self._error("AI_PROVIDER_RESPONSE_INVALID", 422, False)
            if model_id in seen:
                continue
            seen.add(model_id)
            models.append(DiscoveredModel(provider_model_id=model_id, display_name=model_id))
        return models

    @staticmethod
    def _error(code: str, status_code: int, retryable: bool) -> APIError:
        return APIError(
            code=code,
            message="The AI Provider discovery request could not be completed.",
            status_code=status_code,
            retryable=retryable,
        )
