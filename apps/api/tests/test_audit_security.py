from datetime import UTC, datetime
from uuid import UUID

import pytest
from logion_api.audit.routes import _enforce_rate_limit
from logion_api.audit.service import AuditQueryService
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent
from logion_api.identity.security import IdentitySecurity
from logion_api.main import app


class RecordingRateLimiter:
    def __init__(self) -> None:
        self.calls: list[dict[str, str | int]] = []

    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None:
        self.calls.append(
            {
                "scope": scope,
                "subject_hash": subject_hash,
                "limit": limit,
                "window": window,
            }
        )


def _service() -> AuditQueryService:
    return AuditQueryService(IdentitySecurity("audit-test-secret-key-at-least-32-bytes"))


def test_audit_query_limit_is_bounded() -> None:
    assert Settings().audit_query_limit_per_minute == 60


@pytest.mark.asyncio
async def test_audit_query_rate_limit_is_account_scoped_and_privacy_hashed() -> None:
    limiter = RecordingRateLimiter()
    identity = "user:00000000-0000-0000-0000-000000000123"

    await _enforce_rate_limit(
        limiter,  # type: ignore[arg-type]
        Settings(audit_query_limit_per_minute=7),
        identity,
    )

    assert limiter.calls == [
        {
            "scope": "audit_query",
            "subject_hash": limiter.calls[0]["subject_hash"],
            "limit": 7,
            "window": 60,
        }
    ]
    assert limiter.calls[0]["subject_hash"] != identity
    assert len(str(limiter.calls[0]["subject_hash"])) == 64


def test_signed_cursor_round_trip_and_scope_binding() -> None:
    service = _service()
    occurred_at = datetime(2026, 7, 20, 8, 30, tzinfo=UTC)
    event_id = UUID("00000000-0000-0000-0000-000000000123")
    fingerprint = service.filter_fingerprint("identity.login_succeeded", "success", None, None)
    cursor = service.encode_cursor(
        scope="user:one",
        fingerprint=fingerprint,
        occurred_at=occurred_at,
        event_id=event_id,
    )

    decoded = service.decode_cursor(cursor, scope="user:one", fingerprint=fingerprint)
    assert decoded.occurred_at == occurred_at
    assert decoded.event_id == event_id

    with pytest.raises(APIError) as scope_error:
        service.decode_cursor(cursor, scope="user:two", fingerprint=fingerprint)
    assert scope_error.value.code == "AUDIT_CURSOR_INVALID"

    changed_filter = service.filter_fingerprint("identity.logout", "success", None, None)
    with pytest.raises(APIError) as filter_error:
        service.decode_cursor(cursor, scope="user:one", fingerprint=changed_filter)
    assert filter_error.value.code == "AUDIT_CURSOR_INVALID"


def test_cursor_tamper_and_naive_time_are_rejected() -> None:
    service = _service()
    fingerprint = service.filter_fingerprint(None, None, None, None)
    cursor = service.encode_cursor(
        scope="workspace:one",
        fingerprint=fingerprint,
        occurred_at=datetime(2026, 7, 20, 8, 30, tzinfo=UTC),
        event_id=UUID("00000000-0000-0000-0000-000000000123"),
    )
    replacement = "A" if cursor[len(cursor) // 2] != "A" else "B"
    tampered = cursor[: len(cursor) // 2] + replacement + cursor[len(cursor) // 2 + 1 :]

    with pytest.raises(APIError) as tamper_error:
        service.decode_cursor(tampered, scope="workspace:one", fingerprint=fingerprint)
    assert tamper_error.value.code == "AUDIT_CURSOR_INVALID"
    with pytest.raises(APIError) as time_error:
        service.filter_fingerprint(None, None, datetime(2026, 7, 20, 8, 30), None)
    assert time_error.value.code == "AUDIT_RANGE_INVALID"


def test_openapi_audit_response_omits_internal_metadata() -> None:
    schemas = app.openapi()["components"]["schemas"]
    properties = schemas["AuditEventResponse"]["properties"]

    assert "event_metadata" not in properties
    assert "metadata" not in properties
    assert "request_id" not in properties


def test_openapi_audit_filters_and_pages_are_bounded() -> None:
    operation = app.openapi()["paths"]["/api/v1/audit/me"]["get"]
    parameters = {parameter["name"]: parameter["schema"] for parameter in operation["parameters"]}

    assert parameters["page_size"]["minimum"] == 1
    assert parameters["page_size"]["maximum"] == 100
    assert parameters["cursor"]["anyOf"][0]["maxLength"] == 1024
    assert parameters["event_type"]["anyOf"][0]["maxLength"] == 80
    assert parameters["result"]["anyOf"][0]["maxLength"] == 32


def test_audit_query_indexes_match_keyset_order() -> None:
    indexes = {
        index.name: tuple(column.name for column in index.columns)
        for index in AuditEvent.__table__.indexes
    }

    assert indexes["ix_audit_events_actor_time_id"] == ("actor_id", "occurred_at", "id")
    assert indexes["ix_audit_events_workspace_time_id"] == (
        "workspace_id",
        "occurred_at",
        "id",
    )
