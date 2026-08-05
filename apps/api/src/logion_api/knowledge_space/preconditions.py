import base64
import hashlib
import hmac
from uuid import UUID

from logion_api.errors import APIError


def make_strong_etag(
    *,
    key: bytes,
    entity_kind: str,
    entity_id: UUID,
    version: int,
) -> str:
    if len(key) < 32:
        raise ValueError("ETag key must contain at least 32 bytes")
    if not entity_kind or version < 1:
        raise ValueError("ETag inputs are invalid")
    payload = f"knowledge-etag-v1:{entity_kind}:{entity_id}:{version}".encode()
    digest = hmac.new(key, payload, hashlib.sha256).digest()
    token = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f'"{token}"'


def validate_write_precondition(
    *,
    expected_version: int,
    current_version: int,
    if_match: str | None,
    current_etag: str,
) -> None:
    if expected_version != current_version:
        raise APIError(
            code="KNOWLEDGE_VERSION_CONFLICT",
            message="The knowledge object changed before this request was applied.",
            status_code=409,
            headers={"Cache-Control": "private, no-store"},
        )
    if if_match is not None and not hmac.compare_digest(if_match, current_etag):
        raise APIError(
            code="KNOWLEDGE_PRECONDITION_INVALID",
            message="The request precondition does not match the expected version.",
            status_code=400,
            headers={"Cache-Control": "private, no-store"},
        )


def if_none_match_matches(if_none_match: str | None, current_etag: str) -> bool:
    if if_none_match is None:
        return False
    candidates = [candidate.strip() for candidate in if_none_match.split(",")]
    return "*" in candidates or any(
        hmac.compare_digest(candidate, current_etag) for candidate in candidates
    )
