import time
from collections.abc import Awaitable
from typing import cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from logion_api.errors import APIError


class RateLimiter:
    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url

    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None:
        bucket = int(time.time()) // window
        key = f"logion:rate:{scope}:{subject_hash}:{bucket}"
        redis = Redis.from_url(self._redis_url)
        try:
            async with redis.pipeline(transaction=True) as pipeline:
                pipeline.incr(key)
                pipeline.expire(key, window + 5)
                results = await pipeline.execute()
        except RedisError as exc:
            raise APIError(
                code="AUTH_RATE_LIMIT_UNAVAILABLE",
                message="Authentication is temporarily unavailable.",
                status_code=503,
                retryable=True,
            ) from exc
        finally:
            await cast(Awaitable[None], redis.aclose())

        if int(results[0]) > limit:
            raise APIError(
                code="AUTH_RATE_LIMITED",
                message="Too many authentication attempts. Try again later.",
                status_code=429,
                details={"retry_after_seconds": window},
                retryable=True,
            )
