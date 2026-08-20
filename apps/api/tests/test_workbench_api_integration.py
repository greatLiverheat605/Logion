from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings, get_settings
from logion_api.db import get_session, session_factory
from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    get_current_context,
    get_identity_service,
    get_rate_limiter,
)
from logion_api.identity.models import User
from logion_api.identity.rate_limit import RateLimiter
from logion_api.identity.service import AuthContext
from logion_api.main import create_app
from logion_api.workbenches import quota
from logion_api.workbenches.models import WorkbenchDefinition
from logion_api.workbenches.repository import WorkbenchRepository
from logion_api.workbenches.routes import (
    ImpactSigner,
    _cursor_scope,
    _decode_cursor,
    _encode_cursor,
    _etag,
    _validate_if_match,
    get_workbench_repository,
    get_workbench_service,
)
from logion_api.workbenches.schemas import (
    WorkbenchDefinitionDeleteReceipt,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionResponse,
    WorkbenchExportV1,
)
from logion_api.workbenches.service import WorkbenchService, canonical_fingerprint
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

BASE_PATH = "/api/v1/users/me/workbenches"
ORIGIN = "http://localhost:3000"
KEY_CURRENT = "c" * 32
KEY_PREVIOUS = "p" * 32


def _settings(**updates: Any) -> Settings:
    values = {
        "workbench_custom_api_enabled": True,
        "workbench_impact_active_key_id": "current",
        "workbench_impact_previous_key_id": "previous",
        "workbench_impact_keys": {
            "current": KEY_CURRENT,
            "previous": KEY_PREVIOUS,
        },
    }
    values.update(updates)
    return Settings.model_validate(values)


def _document(name: str = "Research desk") -> WorkbenchDefinitionDocumentV1:
    return WorkbenchDefinitionDocumentV1.model_validate(
        {
            "contract": "workbench.definition",
            "schemaVersion": 1,
            "payload": {
                "name": name,
                "description": "",
                "icon": "microscope",
                "accent": "cyan",
                "templateId": "fixed.research",
                "modules": [],
                "layout": {"columns": 1, "items": []},
                "filters": [],
                "quickCreate": [],
                "fieldDefinitions": [],
            },
        }
    )


def _definition_response(owner_id: UUID, definition_id: UUID) -> WorkbenchDefinitionResponse:
    now = datetime.now(UTC)
    return WorkbenchDefinitionResponse(
        id=definition_id,
        owner_user_id=owner_id,
        name="Research desk",
        description="",
        icon="microscope",
        accent="cyan",
        template_id="fixed.research",
        revision=1,
        lifecycle="active",
        created_at=now,
        updated_at=now,
        document=_document(),
    )


def _definition_row(owner_id: UUID, definition_id: UUID) -> WorkbenchDefinition:
    response = _definition_response(owner_id, definition_id)
    return WorkbenchDefinition(
        id=definition_id,
        owner_user_id=owner_id,
        name=response.name,
        description=response.description,
        icon=response.icon,
        accent=response.accent,
        template_id=response.template_id,
        lifecycle=response.lifecycle,
        document=response.document.model_dump(mode="json", by_alias=True),
        revision=response.revision,
        link_set_revision=1,
        created_at=response.created_at,
        updated_at=response.updated_at,
    )


def _api(
    monkeypatch: pytest.MonkeyPatch,
    *,
    settings: Settings | None = None,
    repository: Any | None = None,
    service: Any | None = None,
    events: list[str] | None = None,
) -> tuple[Any, AsyncMock, Any, Any, UUID]:
    active_settings = settings or _settings()
    monkeypatch.setattr("logion_api.main.get_settings", lambda: active_settings)
    application = create_app()
    owner_id = uuid4()
    db = cast(AsyncSession, AsyncMock(spec=AsyncSession))
    repository = repository or Mock(spec=WorkbenchRepository)
    service = service or Mock(spec=WorkbenchService)
    limiter = SimpleNamespace(enforce=AsyncMock())

    async def context() -> AuthContext:
        if events is not None:
            events.append("session")
        return cast(
            AuthContext,
            SimpleNamespace(
                user=SimpleNamespace(id=owner_id),
                session=object(),
                device=object(),
            ),
        )

    async def session() -> Any:
        yield db

    def validate_csrf(_session: object, supplied: str | None, cookie: str | None) -> None:
        if events is not None:
            events.append("csrf")
        if supplied != "csrf-ok" or cookie != "csrf-ok":
            raise APIError(
                code="AUTH_CSRF_INVALID",
                message="The CSRF token is invalid.",
                status_code=403,
            )

    async def enforce(**_kwargs: object) -> None:
        if events is not None:
            events.append("rate")

    limiter.enforce.side_effect = enforce
    identity = SimpleNamespace(validate_csrf=validate_csrf)
    application.dependency_overrides[get_settings] = lambda: active_settings
    application.dependency_overrides[get_current_context] = context
    application.dependency_overrides[get_session] = session
    application.dependency_overrides[get_identity_service] = lambda: identity
    application.dependency_overrides[get_rate_limiter] = lambda: limiter
    application.dependency_overrides[get_workbench_repository] = lambda: repository
    application.dependency_overrides[get_workbench_service] = lambda: service
    return application, cast(AsyncMock, db), repository, service, owner_id


def _headers(**extra: str) -> dict[str, str]:
    return {
        "Origin": ORIGIN,
        "X-CSRF-Token": "csrf-ok",
        **extra,
    }


@pytest.mark.asyncio
async def test_create_uses_strict_body_and_returns_opaque_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = Mock(spec=WorkbenchService)
    definition_id = uuid4()
    application, db, _repository, service, owner_id = _api(
        monkeypatch,
        service=service,
    )
    service.create_definition = AsyncMock(
        return_value=_definition_response(owner_id, definition_id)
    )
    payload = {"document": _document().model_dump(mode="json", by_alias=True)}

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.post(
            BASE_PATH,
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json=payload,
        )

        duplicate = await client.post(
            BASE_PATH,
            headers={
                **_headers(**{"Idempotency-Key": str(uuid4())}),
                "Content-Type": "application/json",
            },
            content=b'{"document":{},"document":{}}',
        )
        unsafe = await client.post(
            BASE_PATH,
            headers={
                **_headers(**{"Idempotency-Key": str(uuid4())}),
                "Content-Type": "application/json",
            },
            content=b'{"document":{"payload":{"__proto__":{}}}}',
        )
        service.create_definition.side_effect = APIError(
            code="WORKBENCH_RATE_LIMITED",
            message="The Workbench limit has been reached.",
            status_code=429,
            retryable=True,
        )
        quota_limited = await client.post(
            BASE_PATH,
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json=payload,
        )

    assert response.status_code == 201
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.headers["Location"].endswith(str(definition_id))
    assert response.headers["ETag"].startswith('"')
    assert str(definition_id) not in response.headers["ETag"]
    assert response.json()["ownerUserId"] == str(owner_id)
    db.commit.assert_awaited_once()
    assert duplicate.status_code == unsafe.status_code == 422
    assert duplicate.json()["code"] == unsafe.json()["code"] == "WORKBENCH_SCHEMA_INVALID"
    assert "__proto__" not in unsafe.text
    assert quota_limited.status_code == 429
    assert quota_limited.headers["Retry-After"] == "3600"
    assert quota_limited.json()["details"] == {}
    assert service.create_definition.await_count == 2


@pytest.mark.asyncio
async def test_security_rate_and_owner_resolution_precede_malformed_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []
    repository = Mock(spec=WorkbenchRepository)

    async def missing_owner(*_args: object, **_kwargs: object) -> None:
        events.append("owner")
        return None

    repository.get_definition = AsyncMock(side_effect=missing_owner)
    service = Mock(spec=WorkbenchService)
    service.replace_definition = AsyncMock()
    application, _db, _repository, service, _owner_id = _api(
        monkeypatch,
        repository=repository,
        service=service,
        events=events,
    )

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.put(
            f"{BASE_PATH}/{uuid4()}",
            headers={**_headers(), "Content-Type": "application/json"},
            content=b"{not-json",
        )

    assert response.status_code == 404
    assert response.json()["code"] == "RESOURCE_NOT_FOUND"
    assert response.json()["details"] == {}
    assert events == ["session", "csrf", "rate", "owner"]
    service.replace_definition.assert_not_awaited()


@pytest.mark.asyncio
async def test_body_limit_and_bom_fail_before_service_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = Mock(spec=WorkbenchService)
    service.create_definition = AsyncMock()
    application, _db, _repository, service, _owner_id = _api(
        monkeypatch,
        settings=_settings(workbench_request_body_limit_bytes=1024),
        service=service,
    )

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        too_large = await client.post(
            BASE_PATH,
            headers={
                **_headers(**{"Idempotency-Key": str(uuid4())}),
                "Content-Type": "application/json",
            },
            content=b" " * 1025,
        )
        bom = await client.post(
            BASE_PATH,
            headers={
                **_headers(**{"Idempotency-Key": str(uuid4())}),
                "Content-Type": "application/json",
            },
            content=b"\xef\xbb\xbf{}",
        )

    assert too_large.status_code == 413
    assert too_large.json()["details"] == {}
    assert bom.status_code == 422
    service.create_definition.assert_not_awaited()


@pytest.mark.asyncio
async def test_import_failure_rolls_back_and_never_commits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = Mock(spec=WorkbenchService)
    service.import_definition = AsyncMock(side_effect=SQLAlchemyError("simulated write failure"))
    application, db, _repository, service, _owner_id = _api(monkeypatch, service=service)
    exported = {
        "contract": "workbench.export",
        "schemaVersion": 1,
        "document": _document().model_dump(mode="json", by_alias=True),
        "links": None,
    }
    payload = {
        "sourceFingerprint": canonical_fingerprint(exported),
        "payload": exported,
    }

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.post(
            f"{BASE_PATH}/imports",
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json=payload,
        )

    assert response.status_code == 503
    assert response.json()["code"] == "WORKBENCH_SERVICE_UNAVAILABLE"
    assert response.json()["retryable"] is True
    assert "simulated" not in response.text
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_failure_is_not_advertised_as_safely_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = Mock(spec=WorkbenchService)
    definition_id = uuid4()
    application, db, _repository, service, owner_id = _api(
        monkeypatch,
        service=service,
    )
    service.create_definition = AsyncMock(
        return_value=_definition_response(owner_id, definition_id)
    )
    db.commit.side_effect = SQLAlchemyError("simulated uncertain commit")
    db.rollback.side_effect = SQLAlchemyError("simulated rollback failure")

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.post(
            BASE_PATH,
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json={"document": _document().model_dump(mode="json", by_alias=True)},
        )

    assert response.status_code == 503
    assert response.json()["code"] == "WORKBENCH_SERVICE_UNAVAILABLE"
    assert response.json()["retryable"] is False
    assert "simulated" not in response.text
    db.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_export_over_serialized_limit_fails_closed_without_truncation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(workbench_export_response_limit_bytes=1024)
    repository = Mock(spec=WorkbenchRepository)
    service = Mock(spec=WorkbenchService)
    workbench_id = uuid4()
    application, _db, repository, service, owner_id = _api(
        monkeypatch,
        settings=settings,
        repository=repository,
        service=service,
    )
    repository.get_definition = AsyncMock(return_value=_definition_row(owner_id, workbench_id))
    document = _document().model_dump(mode="json", by_alias=True)
    cast(dict[str, Any], document["payload"])["description"] = chr(0x1F600) * 280
    service.export_definition = AsyncMock(
        return_value=WorkbenchExportV1(
            contract="workbench.export",
            schema_version=1,
            document=WorkbenchDefinitionDocumentV1.model_validate(document),
            links=None,
        )
    )

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.get(
            f"{BASE_PATH}/{workbench_id}/export",
            headers=_headers(),
        )

    assert response.status_code == 503
    assert response.json()["code"] == "WORKBENCH_EXPORT_TOO_LARGE"
    assert response.json()["retryable"] is True
    assert response.headers["Cache-Control"] == "private, no-store"
    assert chr(0x1F600) not in response.text


@pytest.mark.asyncio
async def test_delete_receipt_replay_does_not_require_deleted_definition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(workbench_delete_api_enabled=True)
    repository = Mock(spec=WorkbenchRepository)
    repository.get_receipt = AsyncMock(return_value=SimpleNamespace(operation="existing"))
    repository.get_definition = AsyncMock()
    service = Mock(spec=WorkbenchService)
    workbench_id = uuid4()
    receipt = WorkbenchDefinitionDeleteReceipt(
        receipt_id=uuid4(),
        deleted_definition_id=workbench_id,
        deleted_link_count=2,
        preference_fallback=True,
        deleted_at=datetime.now(UTC),
    )
    service.delete_definition = AsyncMock(return_value=receipt)
    application, db, _repository, service, _owner_id = _api(
        monkeypatch,
        settings=settings,
        repository=repository,
        service=service,
    )

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        response = await client.request(
            "DELETE",
            f"{BASE_PATH}/{workbench_id}",
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json={
                "expectedRevision": 1,
                "expectedLinkSetRevision": 3,
                "impactFingerprint": "current.signature",
            },
        )

    assert response.status_code == 200
    assert response.json()["receiptId"] == str(receipt.receipt_id)
    repository.get_definition.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_quota_translates_429_and_preserves_fail_closed_503(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    owner_id = uuid4()
    enforce_mock = AsyncMock(
        side_effect=APIError(
            code="AUTH_RATE_LIMITED",
            message="limited",
            status_code=429,
            details={"retry_after_seconds": 3600},
            retryable=True,
        )
    )
    limiter = cast(
        RateLimiter,
        SimpleNamespace(enforce=enforce_mock),
    )
    monkeypatch.setattr("logion_api.workbenches.quota.time.time", lambda: 3601.0)

    with pytest.raises(APIError) as limited:
        await quota.enforce_workbench_quota(limiter, settings, owner_id, "read")
    assert limited.value.code == "WORKBENCH_RATE_LIMITED"
    assert limited.value.details == {}
    assert limited.value.retryable is True
    assert limited.value.headers["Retry-After"] == "3599"
    assert 1 <= int(limited.value.headers["Retry-After"]) <= 3600

    enforce_mock.side_effect = APIError(
        code="AUTH_RATE_LIMIT_UNAVAILABLE",
        message="unavailable",
        status_code=503,
        retryable=True,
    )
    with pytest.raises(APIError) as unavailable:
        await quota.enforce_workbench_quota(limiter, settings, owner_id, "read")
    assert unavailable.value.status_code == 503
    assert unavailable.value.headers["Cache-Control"] == "private, no-store"


def test_impact_key_rotation_cursor_binding_and_etag_preconditions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    claims = {
        "ownerUserId": str(uuid4()),
        "workbenchId": str(uuid4()),
        "revision": 2,
        "linkSetRevision": 4,
        "linkCount": 3,
        "preferenceWillFallback": False,
        "fallbackWorkbenchId": "fixed.learning",
        "formalObjectDeleteCount": 0,
    }
    previous = ImpactSigner(
        _settings(
            workbench_impact_active_key_id="previous",
            workbench_impact_previous_key_id=None,
        )
    )
    current = ImpactSigner(_settings())
    old_token = previous.sign(claims)
    assert current.verify(claims, old_token)
    assert not current.verify({**claims, "linkCount": 4}, old_token)

    settings = _settings(workbench_cursor_ttl_seconds=60)
    context = cast(
        AuthContext,
        SimpleNamespace(user=SimpleNamespace(id=uuid4()), session=object(), device=object()),
    )
    scope = _cursor_scope(
        context,
        endpoint="definition-list",
        resource="me",
        filters={"lifecycle": "active"},
        order="updatedAt:desc,id:desc",
    )
    monkeypatch.setattr("logion_api.workbenches.routes.time.time", lambda: 1000.0)
    cursor = _encode_cursor(
        settings,
        scope=scope,
        snapshot_at=datetime.now(UTC),
        position={"id": str(uuid4()), "updatedAt": datetime.now(UTC).isoformat()},
    )
    _decode_cursor(settings, cursor, scope=scope)
    with pytest.raises(APIError) as rebound:
        _decode_cursor(settings, cursor, scope={**scope, "filters": {"lifecycle": "archived"}})
    assert rebound.value.code == "WORKBENCH_SCHEMA_INVALID"

    monkeypatch.setattr("logion_api.workbenches.routes.time.time", lambda: 1061.0)
    with pytest.raises(APIError, match="Workbench request"):
        _decode_cursor(settings, cursor, scope=scope)

    entity_id = uuid4()
    first = _etag(settings, "definition", entity_id, 1)
    second = _etag(settings, "definition", entity_id, 2)
    assert first != second
    assert str(entity_id) not in first
    _validate_if_match(first, first)
    with pytest.raises(APIError) as stale:
        _validate_if_match(first, second)
    assert stale.value.code == "WORKBENCH_PRECONDITION_INVALID"


@pytest.mark.asyncio
async def test_cors_admits_patch_and_concurrency_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    application, _db, _repository, _service, _owner_id = _api(monkeypatch)
    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        response = await client.options(
            f"{BASE_PATH}/{uuid4()}",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "Idempotency-Key,If-Match,If-None-Match",
            },
        )

    assert response.status_code == 200
    assert "PATCH" in response.headers["Access-Control-Allow-Methods"]
    allowed_headers = response.headers["Access-Control-Allow-Headers"].lower()
    assert "idempotency-key" in allowed_headers
    assert "if-match" in allowed_headers
    assert "if-none-match" in allowed_headers


@pytest.mark.integration
@pytest.mark.asyncio
async def test_real_postgres_and_redis_create_through_enabled_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    environment = Settings()
    settings = _settings(
        database_url=environment.database_url,
        redis_url=environment.redis_url,
        workbench_definition_create_limit_per_hour=1,
    )
    monkeypatch.setattr("logion_api.main.get_settings", lambda: settings)
    application = create_app()
    owner_id = uuid4()
    email = f"c6-a-{owner_id}@example.test"
    async with session_factory() as db:
        db.add(User(id=owner_id, email=email, email_normalized=email))
        await db.commit()

    async def context() -> AuthContext:
        return cast(
            AuthContext,
            SimpleNamespace(
                user=SimpleNamespace(id=owner_id),
                session=object(),
                device=object(),
            ),
        )

    def validate_csrf(_session: object, supplied: str | None, cookie: str | None) -> None:
        if supplied != "csrf-ok" or cookie != "csrf-ok":
            raise AssertionError("integration CSRF boundary failed")

    application.dependency_overrides[get_settings] = lambda: settings
    application.dependency_overrides[get_current_context] = context
    application.dependency_overrides[get_identity_service] = lambda: SimpleNamespace(
        validate_csrf=validate_csrf
    )
    application.dependency_overrides[get_rate_limiter] = lambda: RateLimiter(settings.redis_url)
    key = uuid4()

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
        cookies={"logion_csrf": "csrf-ok"},
    ) as client:
        created = await client.post(
            BASE_PATH,
            headers=_headers(**{"Idempotency-Key": str(key)}),
            json={"document": _document().model_dump(mode="json", by_alias=True)},
        )
        limited = await client.post(
            BASE_PATH,
            headers=_headers(**{"Idempotency-Key": str(uuid4())}),
            json={"document": _document("Second desk").model_dump(mode="json", by_alias=True)},
        )

    assert created.status_code == 201
    assert limited.status_code == 429
    assert limited.json()["code"] == "WORKBENCH_RATE_LIMITED"
    assert 1 <= int(limited.headers["Retry-After"]) <= 3600
    async with session_factory() as db:
        count = await db.scalar(
            select(func.count(WorkbenchDefinition.id)).where(
                WorkbenchDefinition.owner_user_id == owner_id
            )
        )
    assert count == 1
