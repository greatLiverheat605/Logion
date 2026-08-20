from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any, Literal, TypeGuard, cast
from uuid import UUID

import rfc8785
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
)
from logion_api.workbenches.repository import (
    DefinitionCursor,
    DefinitionPage,
    WorkbenchRepository,
)
from logion_api.workbenches.schemas import (
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionReplaceRequest,
    WorkbenchDefinitionResponse,
)

CREATE_OPERATION = "workbench.definition.create.v1"


class WorkbenchService:
    def __init__(
        self,
        repository: WorkbenchRepository,
        *,
        active_definition_limit: int,
        total_definition_limit: int,
    ) -> None:
        self._repository = repository
        self._active_definition_limit = active_definition_limit
        self._total_definition_limit = total_definition_limit

    async def create_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        payload: WorkbenchDefinitionCreateRequest,
        idempotency_key: UUID,
    ) -> WorkbenchDefinitionResponse:
        await self._require_locked_owner(db, owner_user_id)
        fingerprint = request_fingerprint(CREATE_OPERATION, {}, payload)
        receipt = await self._repository.get_receipt(db, owner_user_id, idempotency_key)
        if receipt is not None:
            return await self._replay_create(db, owner_user_id, receipt, fingerprint)

        counts = await self._repository.count_definitions(db, owner_user_id)
        if (
            counts.active >= self._active_definition_limit
            or counts.total >= self._total_definition_limit
        ):
            raise _quota_error()

        document = _document_json(payload.document)
        now = utc_now()
        definition = WorkbenchDefinition(
            id=uuid7(),
            owner_user_id=owner_user_id,
            name=payload.document.payload.name,
            description=payload.document.payload.description,
            icon=payload.document.payload.icon,
            accent=payload.document.payload.accent,
            template_id=payload.document.payload.template_id,
            lifecycle="active",
            document=document,
            revision=1,
            link_set_revision=1,
            created_at=now,
            updated_at=now,
        )
        self._repository.add_definition(db, definition)
        await db.flush()
        response = definition_response(definition)
        self._repository.add_receipt(
            db,
            WorkbenchIdempotencyReceipt(
                owner_user_id=owner_user_id,
                operation=CREATE_OPERATION,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                outcome="succeeded",
                retryable=False,
                definition_id=definition.id,
                response_snapshot=response.model_dump(mode="json", by_alias=True),
            ),
        )
        await db.flush()
        return response

    async def get_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
    ) -> WorkbenchDefinitionResponse:
        definition = await self._owned_definition(db, owner_user_id, definition_id)
        return definition_response(definition)

    async def list_definitions(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        *,
        lifecycle: Literal["active", "archived"] | None,
        limit: int,
        cursor: DefinitionCursor | None = None,
    ) -> DefinitionPage:
        snapshot_at = cursor.snapshot_at if cursor is not None else datetime.now(UTC)
        return await self._repository.list_definitions(
            db,
            owner_user_id,
            lifecycle=lifecycle,
            limit=limit,
            snapshot_at=snapshot_at,
            cursor=cursor,
        )

    async def replace_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchDefinitionReplaceRequest,
    ) -> WorkbenchDefinitionResponse:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        if definition.revision != payload.expected_revision:
            raise _version_conflict(definition, payload)
        _apply_document(definition, payload.local)
        definition.revision += 1
        definition.updated_at = utc_now()
        await db.flush()
        return definition_response(definition)

    async def archive_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchDefinitionLifecycleRequest,
    ) -> WorkbenchDefinitionResponse:
        return await self._change_lifecycle(
            db,
            owner_user_id,
            definition_id,
            payload,
            expected_base="active",
            target="archived",
        )

    async def restore_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchDefinitionLifecycleRequest,
    ) -> WorkbenchDefinitionResponse:
        return await self._change_lifecycle(
            db,
            owner_user_id,
            definition_id,
            payload,
            expected_base="archived",
            target="active",
        )

    async def _change_lifecycle(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchDefinitionLifecycleRequest,
        *,
        expected_base: Literal["active", "archived"],
        target: Literal["active", "archived"],
    ) -> WorkbenchDefinitionResponse:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        if payload.base_lifecycle != expected_base:
            raise _schema_error()
        if definition.revision != payload.expected_revision:
            raise _lifecycle_version_conflict()
        if definition.lifecycle != expected_base:
            raise APIError(
                code="WORKBENCH_OPERATION_DENIED",
                message="The Workbench lifecycle operation is not available.",
                status_code=403,
            )
        if target == "active":
            counts = await self._repository.count_definitions(db, owner_user_id)
            if counts.active >= self._active_definition_limit:
                raise _quota_error()
        definition.lifecycle = target
        definition.revision += 1
        definition.updated_at = utc_now()
        await db.flush()
        return definition_response(definition)

    async def _locked_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
    ) -> WorkbenchDefinition:
        await self._require_locked_owner(db, owner_user_id)
        return await self._owned_definition(
            db,
            owner_user_id,
            definition_id,
            for_update=True,
        )

    async def _owned_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        *,
        for_update: bool = False,
    ) -> WorkbenchDefinition:
        definition = await self._repository.get_definition(
            db,
            owner_user_id,
            definition_id,
            for_update=for_update,
        )
        if definition is None:
            raise _not_found_error()
        return definition

    async def _require_locked_owner(self, db: AsyncSession, owner_user_id: UUID) -> None:
        if not await self._repository.lock_owner(db, owner_user_id):
            raise _not_found_error()

    async def _replay_create(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        receipt: WorkbenchIdempotencyReceipt,
        fingerprint: str,
    ) -> WorkbenchDefinitionResponse:
        if receipt.operation != CREATE_OPERATION or receipt.request_fingerprint != fingerprint:
            raise APIError(
                code="WORKBENCH_IDEMPOTENCY_CONFLICT",
                message="The idempotency key was already used.",
                status_code=409,
            )
        if receipt.definition_id is None:
            raise _not_found_error()
        await self._owned_definition(db, owner_user_id, receipt.definition_id)
        return WorkbenchDefinitionResponse.model_validate(receipt.response_snapshot)


def request_fingerprint(operation: str, resource: dict[str, object], body: Any) -> str:
    body_value = (
        body.model_dump(mode="json", by_alias=True) if hasattr(body, "model_dump") else body
    )
    encoded = rfc8785.dumps(
        cast(Any, {"operation": operation, "resource": resource, "body": body_value})
    )
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def definition_response(definition: WorkbenchDefinition) -> WorkbenchDefinitionResponse:
    return WorkbenchDefinitionResponse(
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
        document=WorkbenchDefinitionDocumentV1.model_validate(definition.document),
    )


def _apply_document(
    definition: WorkbenchDefinition,
    document: WorkbenchDefinitionDocumentV1,
) -> None:
    definition.document = _document_json(document)
    definition.name = document.payload.name
    definition.description = document.payload.description
    definition.icon = document.payload.icon
    definition.accent = document.payload.accent
    definition.template_id = document.payload.template_id


def _document_json(document: WorkbenchDefinitionDocumentV1) -> dict[str, object]:
    return document.model_dump(mode="json", by_alias=True)


def _version_conflict(
    definition: WorkbenchDefinition,
    payload: WorkbenchDefinitionReplaceRequest,
) -> APIError:
    remote = WorkbenchDefinitionDocumentV1.model_validate(definition.document)
    details = {
        "entity": "definition",
        "baseRevision": payload.expected_revision,
        "remoteRevision": definition.revision,
        "conflictPaths": _conflict_paths(
            payload.base.model_dump(mode="json", by_alias=True),
            payload.local.model_dump(mode="json", by_alias=True),
            remote.model_dump(mode="json", by_alias=True),
        ),
        "base": payload.base.model_dump(mode="json", by_alias=True),
        "local": payload.local.model_dump(mode="json", by_alias=True),
        "remote": remote.model_dump(mode="json", by_alias=True),
    }
    return APIError(
        code="WORKBENCH_VERSION_CONFLICT",
        message="The Workbench changed after it was read.",
        status_code=409,
        details=details,
    )


def _lifecycle_version_conflict() -> APIError:
    return APIError(
        code="WORKBENCH_VERSION_CONFLICT",
        message="The Workbench changed after it was read.",
        status_code=409,
    )


def _conflict_paths(base: object, local: object, remote: object, path: str = "$") -> list[str]:
    return list(dict.fromkeys(_collect_conflict_paths(base, local, remote, path)))[:128]


def _collect_conflict_paths(
    base: object,
    local: object,
    remote: object,
    path: str,
) -> list[str]:
    if local in (base, remote) or remote == base:
        return []
    if isinstance(base, dict) and isinstance(local, dict) and isinstance(remote, dict):
        paths: list[str] = []
        for key in sorted(set(base) | set(local) | set(remote)):
            child = f"{path}.{key}" if path != "$" else key
            paths.extend(
                _collect_conflict_paths(base.get(key), local.get(key), remote.get(key), child)
            )
            if len(paths) >= 128:
                return paths[:128]
        return paths
    if _is_keyed_list(base) and _is_keyed_list(local) and _is_keyed_list(remote):
        base_by_id = {item["id"]: item for item in base}
        local_by_id = {item["id"]: item for item in local}
        remote_by_id = {item["id"]: item for item in remote}
        paths = []
        for item_id in sorted(set(base_by_id) | set(local_by_id) | set(remote_by_id)):
            paths.extend(
                _collect_conflict_paths(
                    base_by_id.get(item_id),
                    local_by_id.get(item_id),
                    remote_by_id.get(item_id),
                    f"{path}[{item_id}]",
                )
            )
            if len(paths) >= 128:
                return paths[:128]
        return paths
    return [path[:256]]


def _is_keyed_list(value: object) -> TypeGuard[list[dict[str, Any]]]:
    return isinstance(value, list) and all(
        isinstance(item, dict) and isinstance(item.get("id"), str) for item in value
    )


def _not_found_error() -> APIError:
    return APIError(code="RESOURCE_NOT_FOUND", message="Workbench not found.", status_code=404)


def _quota_error() -> APIError:
    return APIError(
        code="WORKBENCH_RATE_LIMITED",
        message="The Workbench limit has been reached.",
        status_code=429,
        retryable=True,
    )


def _schema_error() -> APIError:
    return APIError(
        code="WORKBENCH_SCHEMA_INVALID",
        message="The Workbench request is invalid.",
        status_code=422,
        details={"issues": [{"path": ["baseLifecycle"], "rule": "lifecycle transition"}]},
    )
