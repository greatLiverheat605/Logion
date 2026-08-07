import base64
import binascii
import hashlib
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from logion_api.errors import APIError

CURSOR_SCHEMA_VERSION = 2
CURSOR_MAX_LENGTH = 1024
CURSOR_MAX_LIFETIME = timedelta(minutes=15)
CURSOR_MAX_CLOCK_SKEW = timedelta(minutes=5)
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MICROSECONDS_PER_SECOND = 1_000_000

type CursorScalar = str | int | bool | None


@dataclass(frozen=True)
class KnowledgeCursorScope:
    subject_hash: str
    workspace_id: str
    space_id: str
    endpoint: str


@dataclass(frozen=True)
class DecodedKnowledgeCursor:
    cutoff_at: datetime
    position: dict[str, CursorScalar]


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    decoded = base64.b64decode(value + padding, altchars=b"-_", validate=True)
    canonical = base64.urlsafe_b64encode(decoded).decode("ascii").rstrip("=")
    if canonical != value:
        raise binascii.Error("non-canonical base64url")
    return decoded


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _filter_digest(filters: Mapping[str, object]) -> str:
    return hashlib.sha256(_canonical_json(dict(filters))).hexdigest()


def _valid_position(value: object) -> bool:
    if not isinstance(value, dict) or len(value) > 16:
        return False
    return all(
        isinstance(key, str)
        and 1 <= len(key) <= 64
        and (
            item is None
            or isinstance(item, (str, bool))
            or (isinstance(item, int) and not isinstance(item, bool))
        )
        and (not isinstance(item, str) or len(item) <= 512)
        for key, item in value.items()
    )


class KnowledgeCursorCodec:
    def __init__(
        self,
        *,
        active_key_id: str,
        keys: Mapping[str, bytes],
        previous_key_id: str | None = None,
        lifetime: timedelta = CURSOR_MAX_LIFETIME,
        clock_skew: timedelta = CURSOR_MAX_CLOCK_SKEW,
    ) -> None:
        if active_key_id not in keys or len(keys[active_key_id]) < 32:
            raise ValueError("active cursor key must contain at least 32 bytes")
        if previous_key_id == active_key_id:
            raise ValueError("active and previous cursor key IDs must differ")
        if previous_key_id is not None and (
            previous_key_id not in keys or len(keys[previous_key_id]) < 32
        ):
            raise ValueError("previous cursor key must contain at least 32 bytes")
        if not timedelta() < lifetime <= CURSOR_MAX_LIFETIME:
            raise ValueError("cursor lifetime exceeds the approved maximum")
        if not timedelta() <= clock_skew <= CURSOR_MAX_CLOCK_SKEW:
            raise ValueError("cursor clock skew exceeds the approved maximum")
        self._active_key_id = active_key_id
        self._previous_key_id = previous_key_id
        self._keys = dict(keys)
        self._lifetime = lifetime
        self._clock_skew = clock_skew

    def encode(
        self,
        *,
        scope: KnowledgeCursorScope,
        filters: Mapping[str, object],
        position: Mapping[str, CursorScalar],
        cutoff_at: datetime,
        now: datetime | None = None,
    ) -> str:
        issued_at = self._normalize_time(now or datetime.now(UTC))
        cutoff = self._normalize_time(cutoff_at)
        safe_position = dict(position)
        if not _valid_position(safe_position):
            raise ValueError("cursor position is not a bounded scalar mapping")
        payload = {
            "cut": self._microsecond_timestamp(cutoff),
            "exp": int((issued_at + self._lifetime).timestamp()),
            "fd": _filter_digest(filters),
            "iat": int(issued_at.timestamp()),
            "kid": self._active_key_id,
            "pos": safe_position,
            "scope": {
                "endpoint": scope.endpoint,
                "space": scope.space_id,
                "subject": scope.subject_hash,
                "workspace": scope.workspace_id,
            },
            "v": CURSOR_SCHEMA_VERSION,
        }
        payload_bytes = _canonical_json(payload)
        signature = hmac.new(
            self._keys[self._active_key_id],
            payload_bytes,
            hashlib.sha256,
        ).digest()
        cursor = f"{_base64url_encode(payload_bytes)}.{_base64url_encode(signature)}"
        if len(cursor) > CURSOR_MAX_LENGTH:
            raise ValueError("encoded cursor exceeds the approved maximum")
        return cursor

    def decode(
        self,
        cursor: str,
        *,
        scope: KnowledgeCursorScope,
        filters: Mapping[str, object],
        now: datetime | None = None,
    ) -> DecodedKnowledgeCursor:
        try:
            if not 1 <= len(cursor) <= CURSOR_MAX_LENGTH or cursor.count(".") != 1:
                raise ValueError("invalid cursor envelope")
            encoded_payload, encoded_signature = cursor.split(".", 1)
            payload_bytes = _base64url_decode(encoded_payload)
            supplied_signature = _base64url_decode(encoded_signature)
            values = json.loads(
                payload_bytes.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_keys,
            )
            if not isinstance(values, dict) or set(values) != {
                "cut",
                "exp",
                "fd",
                "iat",
                "kid",
                "pos",
                "scope",
                "v",
            }:
                raise ValueError("invalid cursor fields")
            key_id = values["kid"]
            allowed_key_ids = {self._active_key_id}
            if self._previous_key_id is not None:
                allowed_key_ids.add(self._previous_key_id)
            if not isinstance(key_id, str) or key_id not in allowed_key_ids:
                raise ValueError("retired cursor key")
            expected_signature = hmac.new(
                self._keys[key_id],
                payload_bytes,
                hashlib.sha256,
            ).digest()
            if not hmac.compare_digest(supplied_signature, expected_signature):
                raise ValueError("invalid cursor signature")
            if values["v"] != CURSOR_SCHEMA_VERSION:
                raise ValueError("invalid cursor version")
            expected_scope = {
                "endpoint": scope.endpoint,
                "space": scope.space_id,
                "subject": scope.subject_hash,
                "workspace": scope.workspace_id,
            }
            if values["scope"] != expected_scope or values["fd"] != _filter_digest(filters):
                raise ValueError("cursor scope mismatch")
            issued_timestamp = self._timestamp(values["iat"])
            expires_timestamp = self._timestamp(values["exp"])
            cutoff_timestamp = self._timestamp(values["cut"])
            current = self._normalize_time(now or datetime.now(UTC))
            issued_at = datetime.fromtimestamp(issued_timestamp, UTC)
            expires_at = datetime.fromtimestamp(expires_timestamp, UTC)
            if expires_at <= issued_at or expires_at - issued_at > self._lifetime:
                raise ValueError("invalid cursor lifetime")
            if issued_at > current + self._clock_skew or expires_at < current - self._clock_skew:
                raise ValueError("expired cursor")
            position = values["pos"]
            if not _valid_position(position):
                raise ValueError("invalid cursor position")
        except (
            binascii.Error,
            UnicodeDecodeError,
            ValueError,
            KeyError,
            TypeError,
            json.JSONDecodeError,
            OverflowError,
            OSError,
        ) as exc:
            raise self.invalid_cursor() from exc
        return DecodedKnowledgeCursor(
            cutoff_at=_EPOCH + timedelta(microseconds=cutoff_timestamp),
            position=cast(dict[str, CursorScalar], position),
        )

    @staticmethod
    def _timestamp(value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("cursor timestamp must be an integer")
        return value

    @staticmethod
    def _microsecond_timestamp(value: datetime) -> int:
        delta = value - _EPOCH
        return (delta.days * 86_400 + delta.seconds) * _MICROSECONDS_PER_SECOND + delta.microseconds

    @staticmethod
    def _normalize_time(value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("cursor timestamps must include a timezone")
        return value.astimezone(UTC)

    @staticmethod
    def invalid_cursor() -> APIError:
        return APIError(
            code="KNOWLEDGE_CURSOR_INVALID",
            message="The knowledge cursor is invalid or no longer applies.",
            status_code=400,
            headers={"Cache-Control": "private, no-store"},
        )
