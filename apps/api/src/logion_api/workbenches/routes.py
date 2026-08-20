from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from collections.abc import Awaitable, Mapping
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    require_trusted_origin,
)
from logion_api.identity.service import AuthContext
from logion_api.workbenches.models import WorkbenchDefinition, WorkbenchLink
from logion_api.workbenches.quota import WorkbenchQuotaOperation, enforce_workbench_quota
from logion_api.workbenches.repository import (
    DefinitionCursor,
    LinkCursor,
    WorkbenchRepository,
)
from logion_api.workbenches.schemas import (
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDeleteReceipt,
    WorkbenchDefinitionDeleteRequest,
    WorkbenchDefinitionDeletionImpact,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionPageResponse,
    WorkbenchDefinitionReplaceRequest,
    WorkbenchDefinitionResponse,
    WorkbenchDefinitionSummary,
    WorkbenchExportV1,
    WorkbenchImportRequest,
    WorkbenchImportSucceededReceipt,
    WorkbenchLinkCreateRequest,
    WorkbenchLinkDeleteReceipt,
    WorkbenchLinkDeleteRequest,
    WorkbenchLinkPageResponse,
    WorkbenchLinkPatchRequest,
    WorkbenchLinkReorderRequest,
    WorkbenchLinkSetResponse,
    WorkbenchObjectLinkResponse,
)
from logion_api.workbenches.service import WorkbenchService

_CACHE_CONTROL = "private, no-store"
_CURSOR_ORDER_DEFINITIONS = "updatedAt:desc,id:desc"
_CURSOR_ORDER_LINKS = "position:asc,id:asc"
_CURSOR_VERSION = 1
_MAX_CURSOR_LENGTH = 1024
_MAX_ISSUES = 32


class _CommitOutcomeUnknownError(Exception):
    pass


def _schema_error(path: list[str] | None = None, rule: str = "invalid request") -> APIError:
    issues = [] if path is None else [{"path": path[:32], "rule": rule[:256]}]
    return APIError(
        code="WORKBENCH_SCHEMA_INVALID",
        message="The Workbench request is invalid.",
        status_code=422,
        details={"issues": issues},
        headers={"Cache-Control": _CACHE_CONTROL},
    )


def _not_found() -> APIError:
    return APIError(
        code="RESOURCE_NOT_FOUND",
        message="The requested resource was not found.",
        status_code=404,
        headers={"Cache-Control": _CACHE_CONTROL},
    )


def _precondition_error() -> APIError:
    return APIError(
        code="WORKBENCH_PRECONDITION_INVALID",
        message="The request precondition is invalid.",
        status_code=400,
        headers={"Cache-Control": _CACHE_CONTROL},
    )


class WorkbenchRoute(APIRoute):
    def get_route_handler(self) -> Any:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except APIError as error:
                error.headers.setdefault("Cache-Control", _CACHE_CONTROL)
                if error.status_code == 429:
                    error.headers.setdefault("Retry-After", "3600")
                raise
            except RequestValidationError as error:
                raise _schema_error() from error
            except _CommitOutcomeUnknownError as error:
                raise APIError(
                    code="WORKBENCH_SERVICE_UNAVAILABLE",
                    message="The Workbench service is temporarily unavailable.",
                    status_code=503,
                    headers={"Cache-Control": _CACHE_CONTROL},
                ) from error
            except SQLAlchemyError as error:
                raise APIError(
                    code="WORKBENCH_SERVICE_UNAVAILABLE",
                    message="The Workbench service is temporarily unavailable.",
                    status_code=503,
                    retryable=True,
                    headers={"Cache-Control": _CACHE_CONTROL},
                ) from error

        return handler


router = APIRouter(
    prefix="/api/v1/users/me/workbenches",
    tags=["workbenches"],
    route_class=WorkbenchRoute,
)
delete_router = APIRouter(
    prefix="/api/v1/users/me/workbenches",
    tags=["workbenches"],
    route_class=WorkbenchRoute,
)


def get_workbench_repository() -> WorkbenchRepository:
    return WorkbenchRepository()


WorkbenchRepositoryDependency = Annotated[
    WorkbenchRepository,
    Depends(get_workbench_repository),
]


def get_workbench_service(
    repository: WorkbenchRepositoryDependency,
    settings: SettingsDependency,
) -> WorkbenchService:
    return WorkbenchService(
        repository,
        active_definition_limit=settings.workbench_active_definition_limit,
        total_definition_limit=settings.workbench_total_definition_limit,
        link_limit=settings.workbench_link_limit,
        link_attributes_limit=settings.workbench_link_attributes_limit_bytes,
    )


WorkbenchServiceDependency = Annotated[WorkbenchService, Depends(get_workbench_service)]


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result or key in {"__proto__", "prototype", "constructor"}:
            raise ValueError("unsafe or duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise ValueError("non-finite JSON number")


def _validate_depth(value: object, maximum: int) -> None:
    stack: list[tuple[object, int]] = [(value, 1)]
    while stack:
        current, depth = stack.pop()
        if not isinstance(current, (dict, list)):
            continue
        if depth > maximum:
            raise ValueError("JSON nesting is too deep")
        children = current.values() if isinstance(current, dict) else current
        stack.extend((child, depth + 1) for child in children)


async def _parse_body[ModelT: BaseModel](
    request: Request,
    model: type[ModelT],
    *,
    maximum_bytes: int,
    maximum_depth: int,
) -> ModelT:
    content_encoding = request.headers.get("content-encoding")
    if content_encoding not in (None, "identity"):
        raise _schema_error(["body"], "compressed request bodies are not accepted")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise _schema_error(["body"], "application/json is required")
    try:
        declared_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        declared_length = 0
    if declared_length > maximum_bytes:
        raise APIError(
            code="REQUEST_BODY_TOO_LARGE",
            message="The request body is too large.",
            status_code=413,
            headers={"Cache-Control": _CACHE_CONTROL},
        )

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum_bytes:
            raise APIError(
                code="REQUEST_BODY_TOO_LARGE",
                message="The request body is too large.",
                status_code=413,
                headers={"Cache-Control": _CACHE_CONTROL},
            )
    try:
        if body.startswith(b"\xef\xbb\xbf"):
            raise ValueError("UTF-8 BOM is not accepted")
        parsed = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
        )
        _validate_depth(parsed, maximum_depth)
        return model.model_validate(parsed)
    except ValidationError as error:
        issues = [
            {
                "path": [str(part) for part in issue["loc"][:32]],
                "rule": str(issue["type"])[:256],
            }
            for issue in error.errors(include_input=False)[:_MAX_ISSUES]
        ]
        raise APIError(
            code="WORKBENCH_SCHEMA_INVALID",
            message="The Workbench request is invalid.",
            status_code=422,
            details={"issues": issues},
            headers={"Cache-Control": _CACHE_CONTROL},
        ) from error
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
        RecursionError,
        TypeError,
        ValueError,
    ) as error:
        raise _schema_error(["body"], "invalid JSON document") from error


def _single_header(request: Request, name: str) -> str | None:
    values = request.headers.getlist(name)
    return values[0] if len(values) == 1 else None


async def _mutation_boundary(
    request: Request,
    context: AuthContext,
    identity: Any,
    limiter: Any,
    settings: Settings,
    operation: WorkbenchQuotaOperation,
) -> None:
    origin = _single_header(request, "origin")
    if origin is None or len(origin) > 2048:
        raise APIError(
            code="AUTH_ORIGIN_INVALID",
            message="The request origin is not allowed.",
            status_code=403,
        )
    require_trusted_origin(request, settings)
    csrf = _single_header(request, "x-csrf-token")
    if csrf is not None and len(csrf) > 4096:
        csrf = None
    identity.validate_csrf(
        context.session,
        csrf,
        request.cookies.get(settings.csrf_cookie_name),
    )
    await enforce_workbench_quota(limiter, settings, context.user.id, operation)


async def _read_boundary(
    context: AuthContext,
    limiter: Any,
    settings: Settings,
) -> None:
    await enforce_workbench_quota(limiter, settings, context.user.id, "read")


async def _require_definition_owner(
    db: AsyncSession,
    repository: WorkbenchRepository,
    owner_user_id: UUID,
    workbench_id: UUID,
) -> WorkbenchDefinition:
    definition = await repository.get_definition(db, owner_user_id, workbench_id)
    if definition is None:
        raise _not_found()
    return definition


async def _require_link_owner(
    db: AsyncSession,
    repository: WorkbenchRepository,
    owner_user_id: UUID,
    workbench_id: UUID,
    link_id: UUID,
) -> tuple[WorkbenchDefinition, WorkbenchLink]:
    definition = await _require_definition_owner(db, repository, owner_user_id, workbench_id)
    link = await repository.get_link(db, owner_user_id, workbench_id, link_id)
    if link is None:
        raise _not_found()
    return definition, link


def _idempotency_key(request: Request) -> UUID:
    value = _single_header(request, "idempotency-key")
    if value is None:
        raise _schema_error(["Idempotency-Key"], "valid UUID header is required")
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        raise _schema_error(["Idempotency-Key"], "valid UUID header is required") from None


def _optional_header(request: Request, name: str, *, maximum: int) -> str | None:
    values = request.headers.getlist(name)
    if not values:
        return None
    if len(values) != 1 or not 1 <= len(values[0]) <= maximum:
        raise _schema_error([name], "invalid header")
    return values[0]


def _if_match(request: Request) -> str | None:
    values = request.headers.getlist("if-match")
    if not values:
        return None
    if len(values) != 1 or not 2 <= len(values[0]) <= 256:
        raise _precondition_error()
    return values[0]


def _bounded_int(request: Request, name: str, *, default: int, maximum: int) -> int:
    value = request.query_params.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        raise _schema_error([name], "integer query parameter is required") from None
    if str(parsed) != value or not 1 <= parsed <= maximum:
        raise _schema_error([name], "query parameter is outside its allowed range")
    return parsed


def _optional_cursor(request: Request) -> str | None:
    value = request.query_params.get("cursor")
    if value is not None and not 1 <= len(value) <= _MAX_CURSOR_LENGTH:
        raise _schema_error(["cursor"], "invalid cursor")
    return value


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    decoded = base64.b64decode(value + padding, altchars=b"-_", validate=True)
    if _base64url_encode(decoded) != value:
        raise ValueError("non-canonical base64url")
    return decoded


def _cursor_scope(
    context: AuthContext,
    *,
    endpoint: str,
    resource: str,
    filters: Mapping[str, object],
    order: str,
) -> dict[str, object]:
    subject = get_security().privacy_hash(f"workbench:{context.user.id}") or "unknown"
    return {
        "endpoint": endpoint,
        "filters": dict(filters),
        "order": order,
        "resource": resource,
        "subject": subject,
    }


def _encode_cursor(
    settings: Settings,
    *,
    scope: Mapping[str, object],
    snapshot_at: datetime,
    position: Mapping[str, object],
) -> str:
    payload = {
        "exp": int(time.time()) + settings.workbench_cursor_ttl_seconds,
        "position": dict(position),
        "scope": dict(scope),
        "snapshotAt": snapshot_at.astimezone(UTC).isoformat(),
        "v": _CURSOR_VERSION,
    }
    encoded_payload = _canonical_json(payload)
    signature = hmac.new(
        settings.secret_key.get_secret_value().encode("utf-8"),
        b"workbench-cursor-v1\x00" + encoded_payload,
        hashlib.sha256,
    ).digest()
    cursor = f"{_base64url_encode(encoded_payload)}.{_base64url_encode(signature)}"
    if len(cursor) > _MAX_CURSOR_LENGTH:
        raise ValueError("encoded cursor is too large")
    return cursor


def _decode_cursor(
    settings: Settings,
    cursor: str,
    *,
    scope: Mapping[str, object],
) -> tuple[datetime, dict[str, object]]:
    try:
        if cursor.count(".") != 1 or len(cursor) > _MAX_CURSOR_LENGTH:
            raise ValueError("invalid cursor envelope")
        encoded_payload, encoded_signature = cursor.split(".", 1)
        payload_bytes = _base64url_decode(encoded_payload)
        supplied = _base64url_decode(encoded_signature)
        expected = hmac.new(
            settings.secret_key.get_secret_value().encode("utf-8"),
            b"workbench-cursor-v1\x00" + payload_bytes,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(supplied, expected):
            raise ValueError("invalid cursor signature")
        payload = json.loads(
            payload_bytes.decode("utf-8"),
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
        )
        if not isinstance(payload, dict) or set(payload) != {
            "exp",
            "position",
            "scope",
            "snapshotAt",
            "v",
        }:
            raise ValueError("invalid cursor fields")
        if payload["v"] != _CURSOR_VERSION or payload["scope"] != dict(scope):
            raise ValueError("cursor scope mismatch")
        expires = payload["exp"]
        if isinstance(expires, bool) or not isinstance(expires, int) or expires < int(time.time()):
            raise ValueError("expired cursor")
        snapshot = datetime.fromisoformat(cast(str, payload["snapshotAt"]))
        if snapshot.tzinfo is None or not isinstance(payload["position"], dict):
            raise ValueError("invalid cursor position")
        return snapshot.astimezone(UTC), cast(dict[str, object], payload["position"])
    except (
        AttributeError,
        binascii.Error,
        json.JSONDecodeError,
        KeyError,
        OverflowError,
        TypeError,
        UnicodeDecodeError,
        ValueError,
    ) as error:
        raise _schema_error(["cursor"], "invalid cursor") from error


def _definition_cursor(
    settings: Settings,
    context: AuthContext,
    cursor: str | None,
    lifecycle: str | None,
) -> DefinitionCursor | None:
    if cursor is None:
        return None
    scope = _cursor_scope(
        context,
        endpoint="definition-list",
        resource="me",
        filters={"lifecycle": lifecycle},
        order=_CURSOR_ORDER_DEFINITIONS,
    )
    snapshot, position = _decode_cursor(settings, cursor, scope=scope)
    try:
        updated_at = datetime.fromisoformat(cast(str, position["updatedAt"]))
        definition_id = UUID(cast(str, position["id"]))
        if updated_at.tzinfo is None or set(position) != {"id", "updatedAt"}:
            raise ValueError("invalid definition cursor")
    except (KeyError, TypeError, ValueError) as error:
        raise _schema_error(["cursor"], "invalid cursor") from error
    return DefinitionCursor(
        snapshot_at=snapshot,
        updated_at=updated_at.astimezone(UTC),
        definition_id=definition_id,
    )


def _link_cursor(
    settings: Settings,
    context: AuthContext,
    cursor: str | None,
    workbench_id: UUID,
) -> LinkCursor | None:
    if cursor is None:
        return None
    scope = _cursor_scope(
        context,
        endpoint="link-list",
        resource=str(workbench_id),
        filters={},
        order=_CURSOR_ORDER_LINKS,
    )
    snapshot, position = _decode_cursor(settings, cursor, scope=scope)
    try:
        raw_position = position["position"]
        if isinstance(raw_position, bool) or not isinstance(raw_position, int):
            raise ValueError("invalid link position")
        link_id = UUID(cast(str, position["id"]))
        if set(position) != {"id", "position"}:
            raise ValueError("invalid link cursor")
    except (KeyError, TypeError, ValueError) as error:
        raise _schema_error(["cursor"], "invalid cursor") from error
    return LinkCursor(snapshot_at=snapshot, position=raw_position, link_id=link_id)


def _etag(settings: Settings, entity_kind: str, entity_id: UUID, revision: int) -> str:
    payload = f"workbench-etag-v1:{entity_kind}:{entity_id}:{revision}".encode("ascii")
    digest = hmac.new(
        settings.secret_key.get_secret_value().encode("utf-8"),
        payload,
        hashlib.sha256,
    ).digest()
    return f'"{_base64url_encode(digest)}"'


def _validate_if_match(if_match: str | None, expected_etag: str) -> None:
    if if_match is not None and not hmac.compare_digest(if_match, expected_etag):
        raise _precondition_error()


def _if_none_match_matches(value: str | None, etag: str) -> bool:
    if value is None:
        return False
    candidates = [candidate.strip() for candidate in value.split(",")]
    return "*" in candidates or any(
        hmac.compare_digest(candidate, etag) for candidate in candidates
    )


class ImpactSigner:
    def __init__(self, settings: Settings) -> None:
        active = settings.workbench_impact_active_key_id
        if active is None:
            raise ValueError("active Workbench impact key is required")
        self._active = active
        self._previous = settings.workbench_impact_previous_key_id
        self._keys = {
            key_id: value.get_secret_value().encode("utf-8")
            for key_id, value in settings.workbench_impact_keys.items()
        }

    @staticmethod
    def _signature(key: bytes, claims: dict[str, object]) -> bytes:
        return hmac.new(
            key,
            b"workbench-impact-v1\x00" + _canonical_json(claims),
            hashlib.sha256,
        ).digest()

    def sign(self, claims: dict[str, object]) -> str:
        return (
            f"{self._active}.{_base64url_encode(self._signature(self._keys[self._active], claims))}"
        )

    def verify(self, claims: dict[str, object], token: str) -> bool:
        try:
            key_id, encoded = token.split(".", 1)
            allowed = {self._active}
            if self._previous is not None:
                allowed.add(self._previous)
            if key_id not in allowed:
                return False
            supplied = _base64url_decode(encoded)
            return hmac.compare_digest(supplied, self._signature(self._keys[key_id], claims))
        except (binascii.Error, KeyError, ValueError):
            return False


def _summary(definition: WorkbenchDefinition) -> WorkbenchDefinitionSummary:
    return WorkbenchDefinitionSummary(
        id=definition.id,
        owner_user_id=definition.owner_user_id,
        name=definition.name,
        description=definition.description,
        icon=definition.icon,
        accent=definition.accent,
        template_id=definition.template_id,
        revision=definition.revision,
        lifecycle=definition.lifecycle,
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )


async def _commit[ResultT](db: AsyncSession, operation: Awaitable[ResultT]) -> ResultT:
    try:
        result = await operation
    except Exception:
        await db.rollback()
        raise
    try:
        await db.commit()
    except Exception as error:
        try:
            await db.rollback()
        finally:
            raise _CommitOutcomeUnknownError from error
    return result


def _success_headers(response: Response, *, etag: str | None = None) -> None:
    response.headers["Cache-Control"] = _CACHE_CONTROL
    if etag is not None:
        response.headers["ETag"] = etag


@router.get("", response_model=WorkbenchDefinitionPageResponse, include_in_schema=False)
async def list_workbenches(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionPageResponse:
    await _read_boundary(context, limiter, settings)
    lifecycle = request.query_params.get("lifecycle")
    if lifecycle not in (None, "active", "archived"):
        raise _schema_error(["lifecycle"], "invalid lifecycle")
    limit = _bounded_int(request, "limit", default=25, maximum=50)
    raw_cursor = _optional_cursor(request)
    cursor = _definition_cursor(settings, context, raw_cursor, lifecycle)
    page = await service.list_definitions(
        db,
        context.user.id,
        lifecycle=cast(Literal["active", "archived"] | None, lifecycle),
        limit=limit,
        cursor=cursor,
    )
    next_cursor = None
    if page.next_cursor is not None:
        scope = _cursor_scope(
            context,
            endpoint="definition-list",
            resource="me",
            filters={"lifecycle": lifecycle},
            order=_CURSOR_ORDER_DEFINITIONS,
        )
        next_cursor = _encode_cursor(
            settings,
            scope=scope,
            snapshot_at=page.next_cursor.snapshot_at,
            position={
                "id": str(page.next_cursor.definition_id),
                "updatedAt": page.next_cursor.updated_at.astimezone(UTC).isoformat(),
            },
        )
    _success_headers(response)
    return WorkbenchDefinitionPageResponse(
        items=[_summary(item) for item in page.items],
        next_cursor=next_cursor,
    )


@router.post(
    "",
    response_model=WorkbenchDefinitionResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_workbench(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionResponse:
    await _mutation_boundary(request, context, identity, limiter, settings, "definition_create")
    payload = await _parse_body(
        request,
        WorkbenchDefinitionCreateRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=7,
    )
    key = _idempotency_key(request)
    result = await _commit(
        db,
        service.create_definition(db, context.user.id, payload, key),
    )
    response.headers["Location"] = f"/api/v1/users/me/workbenches/{result.id}"
    _success_headers(response, etag=_etag(settings, "definition", result.id, result.revision))
    return result


@router.post(
    "/imports",
    response_model=WorkbenchImportSucceededReceipt,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def import_workbench(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchImportSucceededReceipt:
    await _mutation_boundary(request, context, identity, limiter, settings, "import")
    payload = await _parse_body(
        request,
        WorkbenchImportRequest,
        maximum_bytes=settings.workbench_import_body_limit_bytes,
        maximum_depth=8,
    )
    key = _idempotency_key(request)
    result = await _commit(db, service.import_definition(db, context.user.id, payload, key))
    _success_headers(response)
    return result


@router.get(
    "/{workbench_id:uuid}",
    response_model=WorkbenchDefinitionResponse,
    include_in_schema=False,
)
async def get_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> Any:
    await _read_boundary(context, limiter, settings)
    result = await service.get_definition(db, context.user.id, workbench_id)
    etag = _etag(settings, "definition", result.id, result.revision)
    if_none_match = _optional_header(request, "if-none-match", maximum=1024)
    if _if_none_match_matches(if_none_match, etag):
        return Response(
            status_code=status.HTTP_304_NOT_MODIFIED,
            headers={"Cache-Control": _CACHE_CONTROL, "ETag": etag},
        )
    _success_headers(response, etag=etag)
    return result


async def _definition_mutation(
    operation: Literal["definition_replace", "definition_archive", "definition_restore"],
    model: type[WorkbenchDefinitionReplaceRequest] | type[WorkbenchDefinitionLifecycleRequest],
    workbench_id: UUID,
    request: Request,
    context: AuthContext,
    db: AsyncSession,
    identity: Any,
    limiter: Any,
    settings: Settings,
    repository: WorkbenchRepository,
    service: WorkbenchService,
) -> WorkbenchDefinitionResponse:
    await _mutation_boundary(request, context, identity, limiter, settings, operation)
    await _require_definition_owner(db, repository, context.user.id, workbench_id)
    payload = await _parse_body(
        request,
        model,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=7,
    )
    expected_revision = payload.expected_revision
    _validate_if_match(
        _if_match(request),
        _etag(settings, "definition", workbench_id, expected_revision),
    )
    if isinstance(payload, WorkbenchDefinitionReplaceRequest):
        call = service.replace_definition(db, context.user.id, workbench_id, payload)
    elif operation == "definition_archive":
        call = service.archive_definition(db, context.user.id, workbench_id, payload)
    else:
        call = service.restore_definition(db, context.user.id, workbench_id, payload)
    return await _commit(db, call)


@router.put(
    "/{workbench_id:uuid}",
    response_model=WorkbenchDefinitionResponse,
    include_in_schema=False,
)
async def replace_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionResponse:
    result = await _definition_mutation(
        "definition_replace",
        WorkbenchDefinitionReplaceRequest,
        workbench_id,
        request,
        context,
        db,
        identity,
        limiter,
        settings,
        repository,
        service,
    )
    _success_headers(response, etag=_etag(settings, "definition", result.id, result.revision))
    return result


@router.post(
    "/{workbench_id:uuid}/archive",
    response_model=WorkbenchDefinitionResponse,
    include_in_schema=False,
)
async def archive_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionResponse:
    result = await _definition_mutation(
        "definition_archive",
        WorkbenchDefinitionLifecycleRequest,
        workbench_id,
        request,
        context,
        db,
        identity,
        limiter,
        settings,
        repository,
        service,
    )
    _success_headers(response, etag=_etag(settings, "definition", result.id, result.revision))
    return result


@router.post(
    "/{workbench_id:uuid}/restore",
    response_model=WorkbenchDefinitionResponse,
    include_in_schema=False,
)
async def restore_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionResponse:
    result = await _definition_mutation(
        "definition_restore",
        WorkbenchDefinitionLifecycleRequest,
        workbench_id,
        request,
        context,
        db,
        identity,
        limiter,
        settings,
        repository,
        service,
    )
    _success_headers(response, etag=_etag(settings, "definition", result.id, result.revision))
    return result


@router.get(
    "/{workbench_id:uuid}/deletion-impact",
    response_model=WorkbenchDefinitionDeletionImpact,
    include_in_schema=False,
)
async def get_deletion_impact(
    workbench_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionDeletionImpact:
    await _read_boundary(context, limiter, settings)
    result = await service.deletion_impact(
        db,
        context.user.id,
        workbench_id,
        sign_impact=ImpactSigner(settings).sign,
    )
    _success_headers(response)
    return result


@router.get(
    "/{workbench_id:uuid}/export",
    response_model=WorkbenchExportV1,
    include_in_schema=False,
)
async def export_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
) -> Response:
    await _mutation_boundary(request, context, identity, limiter, settings, "export")
    await _require_definition_owner(db, repository, context.user.id, workbench_id)
    raw_include_links = request.query_params.get("include_links", "false")
    if raw_include_links not in {"true", "false"}:
        raise _schema_error(["include_links"], "boolean query parameter is required")
    result = await service.export_definition(
        db,
        context.user.id,
        workbench_id,
        include_links=raw_include_links == "true",
    )
    encoded = json.dumps(
        result.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > settings.workbench_export_response_limit_bytes:
        raise APIError(
            code="WORKBENCH_EXPORT_TOO_LARGE",
            message="The Workbench export is too large.",
            status_code=503,
            retryable=True,
            headers={"Cache-Control": _CACHE_CONTROL},
        )
    return Response(
        content=encoded,
        media_type="application/json",
        headers={
            "Cache-Control": _CACHE_CONTROL,
            "Content-Disposition": f'attachment; filename="workbench-{workbench_id}.json"',
        },
    )


@router.get(
    "/{workbench_id:uuid}/links",
    response_model=WorkbenchLinkPageResponse,
    include_in_schema=False,
)
async def list_links(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchLinkPageResponse:
    await _read_boundary(context, limiter, settings)
    await _require_definition_owner(db, repository, context.user.id, workbench_id)
    limit = _bounded_int(request, "limit", default=50, maximum=100)
    cursor = _link_cursor(settings, context, _optional_cursor(request), workbench_id)
    page = await service.list_links(
        db,
        context.user.id,
        workbench_id,
        limit=limit,
        cursor=cursor,
    )
    next_cursor = None
    if page.next_cursor is not None:
        scope = _cursor_scope(
            context,
            endpoint="link-list",
            resource=str(workbench_id),
            filters={},
            order=_CURSOR_ORDER_LINKS,
        )
        next_cursor = _encode_cursor(
            settings,
            scope=scope,
            snapshot_at=page.next_cursor.snapshot_at,
            position={
                "id": str(page.next_cursor.link_id),
                "position": page.next_cursor.position,
            },
        )
    _success_headers(
        response,
        etag=_etag(settings, "link-set", workbench_id, page.link_set_revision),
    )
    return WorkbenchLinkPageResponse(items=page.items, next_cursor=next_cursor)


@router.post(
    "/{workbench_id:uuid}/links",
    response_model=WorkbenchObjectLinkResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_link(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchObjectLinkResponse:
    await _mutation_boundary(request, context, identity, limiter, settings, "link_create")
    await _require_definition_owner(db, repository, context.user.id, workbench_id)
    payload = await _parse_body(
        request,
        WorkbenchLinkCreateRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=4,
    )
    key = _idempotency_key(request)
    result = await _commit(
        db,
        service.create_link(db, context.user.id, workbench_id, payload, key),
    )
    response.headers["Location"] = f"/api/v1/users/me/workbenches/{workbench_id}/links/{result.id}"
    _success_headers(response, etag=_etag(settings, "link", result.id, result.revision))
    return result


@router.post(
    "/{workbench_id:uuid}/links/reorder",
    response_model=WorkbenchLinkSetResponse,
    include_in_schema=False,
)
async def reorder_links(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchLinkSetResponse:
    await _mutation_boundary(request, context, identity, limiter, settings, "link_reorder")
    await _require_definition_owner(db, repository, context.user.id, workbench_id)
    payload = await _parse_body(
        request,
        WorkbenchLinkReorderRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=2,
    )
    result = await _commit(
        db,
        service.reorder_links(db, context.user.id, workbench_id, payload),
    )
    _success_headers(
        response,
        etag=_etag(settings, "link-set", workbench_id, result.link_set_revision),
    )
    return result


@router.patch(
    "/{workbench_id:uuid}/links/{link_id:uuid}",
    response_model=WorkbenchObjectLinkResponse,
    include_in_schema=False,
)
async def patch_link(
    workbench_id: UUID,
    link_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchObjectLinkResponse:
    await _mutation_boundary(request, context, identity, limiter, settings, "link_patch")
    await _require_link_owner(db, repository, context.user.id, workbench_id, link_id)
    payload = await _parse_body(
        request,
        WorkbenchLinkPatchRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=4,
    )
    _validate_if_match(
        _if_match(request),
        _etag(settings, "link", link_id, payload.expected_revision),
    )
    result = await _commit(
        db,
        service.patch_link(db, context.user.id, workbench_id, link_id, payload),
    )
    _success_headers(response, etag=_etag(settings, "link", result.id, result.revision))
    return result


@delete_router.delete(
    "/{workbench_id:uuid}",
    response_model=WorkbenchDefinitionDeleteReceipt,
    include_in_schema=False,
)
async def delete_workbench(
    workbench_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchDefinitionDeleteReceipt:
    await _mutation_boundary(request, context, identity, limiter, settings, "definition_delete")
    key = _idempotency_key(request)
    receipt = await repository.get_receipt(db, context.user.id, key)
    if receipt is None:
        await _require_definition_owner(db, repository, context.user.id, workbench_id)
    payload = await _parse_body(
        request,
        WorkbenchDefinitionDeleteRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=2,
    )
    _validate_if_match(
        _if_match(request),
        _etag(settings, "definition", workbench_id, payload.expected_revision),
    )
    signer = ImpactSigner(settings)
    result = await _commit(
        db,
        service.delete_definition(
            db,
            context.user.id,
            workbench_id,
            payload,
            key,
            verify_impact=signer.verify,
        ),
    )
    _success_headers(response)
    return result


@delete_router.delete(
    "/{workbench_id:uuid}/links/{link_id:uuid}",
    response_model=WorkbenchLinkDeleteReceipt,
    include_in_schema=False,
)
async def delete_link(
    workbench_id: UUID,
    link_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    repository: WorkbenchRepositoryDependency,
    service: WorkbenchServiceDependency,
    response: Response,
) -> WorkbenchLinkDeleteReceipt:
    await _mutation_boundary(request, context, identity, limiter, settings, "link_delete")
    await _require_link_owner(db, repository, context.user.id, workbench_id, link_id)
    payload = await _parse_body(
        request,
        WorkbenchLinkDeleteRequest,
        maximum_bytes=settings.workbench_request_body_limit_bytes,
        maximum_depth=4,
    )
    _validate_if_match(
        _if_match(request),
        _etag(settings, "link", link_id, payload.expected_revision),
    )
    result = await _commit(
        db,
        service.delete_link(db, context.user.id, workbench_id, link_id, payload),
    )
    _success_headers(
        response,
        etag=_etag(settings, "link-set", workbench_id, result.link_set_revision),
    )
    return result
