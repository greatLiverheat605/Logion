from dataclasses import dataclass
from typing import Protocol

from logion_api.errors import APIError
from logion_api.identity.security import IdentitySecurity


@dataclass(frozen=True)
class KnowledgeRatePolicy:
    caller_limit: int
    workspace_limit: int
    window_seconds: int
    caller_concurrency: int | None = None
    workspace_concurrency: int | None = None


ITEM_READ_RATE = KnowledgeRatePolicy(
    caller_limit=120,
    workspace_limit=1_200,
    window_seconds=60,
)
GRAPH_READ_RATE = KnowledgeRatePolicy(
    caller_limit=20,
    workspace_limit=200,
    window_seconds=60,
    caller_concurrency=2,
    workspace_concurrency=20,
)
KNOWLEDGE_WRITE_RATE = KnowledgeRatePolicy(
    caller_limit=60,
    workspace_limit=600,
    window_seconds=3_600,
)
DRAFT_ACCEPT_RATE = KnowledgeRatePolicy(
    caller_limit=20,
    workspace_limit=200,
    window_seconds=3_600,
    caller_concurrency=1,
    workspace_concurrency=10,
)


class RateLimiterProtocol(Protocol):
    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None: ...


async def enforce_dual_rate_limit(
    limiter: RateLimiterProtocol,
    security: IdentitySecurity,
    *,
    operation: str,
    caller_id: str,
    workspace_id: str,
    policy: KnowledgeRatePolicy,
) -> None:
    buckets = (
        (
            f"knowledge:{operation}:caller",
            f"caller:{caller_id}:workspace:{workspace_id}",
            policy.caller_limit,
        ),
        (
            f"knowledge:{operation}:workspace",
            f"workspace:{workspace_id}",
            policy.workspace_limit,
        ),
    )
    try:
        for scope, subject, limit in buckets:
            await limiter.enforce(
                scope=scope,
                subject_hash=security.privacy_hash(subject) or "unknown",
                limit=limit,
                window=policy.window_seconds,
            )
    except APIError as exc:
        if exc.status_code != 429:
            raise
        retry_after = str(policy.window_seconds)
        raise APIError(
            code="KNOWLEDGE_RATE_LIMITED",
            message="Too many knowledge-space requests. Try again later.",
            status_code=429,
            details={"retry_after_seconds": policy.window_seconds},
            retryable=True,
            headers={
                "Cache-Control": "private, no-store",
                "Retry-After": retry_after,
            },
        ) from exc
