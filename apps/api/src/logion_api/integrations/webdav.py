"""One rate/byte accounting boundary for every WebDAV request, including probes."""

import base64
import json
from collections.abc import Awaitable
from typing import cast
from uuid import uuid4

from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.dialects.postgresql import insert

from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.identity.dependencies import get_security
from logion_api.integrations.keyring import decrypt
from logion_api.integrations.models import IntegrationCredential
from logion_api.integrations.network import (
    IntegrationResponse,
    integration_error,
    request_integration,
)
from logion_api.library.pdf_models import WebDAVUsage

WINDOW = 1800
LIMIT = 600
RATE_SCRIPT = """
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 1800000)
if redis.call('ZCARD', KEYS[1]) >= 600 then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('EXPIRE', KEYS[1], 1801)
return 1
"""


async def enforce_rate(settings: Settings, username: str) -> None:
    subject = get_security().privacy_hash(username.strip().casefold())
    redis = Redis.from_url(settings.redis_url)
    try:
        allowed = await cast(
            Awaitable[int], redis.eval(RATE_SCRIPT, 1, f"logion:webdav:{subject}", uuid4().hex)
        )
    except RedisError as exc:
        raise integration_error("WEBDAV_RATE_UNAVAILABLE", 503) from exc
    finally:
        await cast(Awaitable[None], redis.aclose())
    if not allowed:
        raise integration_error("WEBDAV_RATE_LIMITED", 429)


async def request_webdav(
    settings: Settings,
    credential: IntegrationCredential,
    method: str,
    path: str,
    *,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
    max_bytes: int = 2 * 1024 * 1024,
) -> IntegrationResponse:
    secret = json.loads(
        decrypt(settings.integration_keyring, credential.envelope, aad=credential.aad)
    )
    await enforce_rate(settings, secret["username"])
    basic = base64.b64encode(f"{secret['username']}:{secret['credential']}".encode()).decode()

    async def account(size: int) -> None:
        # A separate transaction counts rejected/oversize downloads too. Never log content.
        async with session_factory() as usage_db:
            statement = insert(WebDAVUsage).values(
                user_id=credential.user_id,
                month=utc_now().date().replace(day=1),
                downloaded_bytes=size,
            )
            await usage_db.execute(
                statement.on_conflict_do_update(
                    index_elements=[WebDAVUsage.user_id, WebDAVUsage.month],
                    set_={"downloaded_bytes": WebDAVUsage.downloaded_bytes + size},
                )
            )
            await usage_db.commit()

    return await request_integration(
        settings,
        "webdav",
        method,
        path,
        headers={**(headers or {}), "Authorization": f"Basic {basic}"},
        content=content,
        max_bytes=max_bytes,
        on_bytes=account,
    )
