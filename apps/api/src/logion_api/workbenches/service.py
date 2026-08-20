from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal, TypeGuard, cast
from uuid import UUID

import rfc8785
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.users.models import UserSetting
from logion_api.users.schemas import UserSettingWrite
from logion_api.users.settings import UserSettingService
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
    WorkbenchLink,
)
from logion_api.workbenches.registry import WorkbenchTargetRegistry
from logion_api.workbenches.repository import (
    DefinitionCursor,
    DefinitionPage,
    LinkCursor,
    WorkbenchRepository,
)
from logion_api.workbenches.schemas import (
    AttributeEqualsFilter,
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDeleteReceipt,
    WorkbenchDefinitionDeleteRequest,
    WorkbenchDefinitionDeletionImpact,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionReplaceRequest,
    WorkbenchDefinitionResponse,
    WorkbenchExportV1,
    WorkbenchImportRequest,
    WorkbenchImportSucceededReceipt,
    WorkbenchLinkCreateRequest,
    WorkbenchLinkDeleteReceipt,
    WorkbenchLinkDeleteRequest,
    WorkbenchLinkMutableV1,
    WorkbenchLinkPatchRequest,
    WorkbenchLinkReorderRequest,
    WorkbenchLinkSetResponse,
    WorkbenchObjectLinkResponse,
    WorkbenchPreferenceDocumentV1,
    WorkbenchSkippedLinks,
    _validate_filter_value,
)

CREATE_OPERATION = "workbench.definition.create.v1"
DELETE_OPERATION = "workbench.definition.delete.v1"
LINK_CREATE_OPERATION = "workbench.link.create.v1"
IMPORT_OPERATION = "workbench.import.v1"
LINK_LIMIT = 500
LINK_ATTRIBUTES_LIMIT = 16 * 1024


@dataclass(frozen=True)
class AuthorizedLinkPage:
    items: list[WorkbenchObjectLinkResponse]
    next_cursor: LinkCursor | None
    link_set_revision: int


class WorkbenchUserSettingService(UserSettingService):
    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        updates: list[UserSettingWrite],
    ) -> list[UserSetting]:
        for update in updates:
            if update.key == "workbench.preference":
                validate_workbench_preference(update.value, update.version + 1)
        return await super().update(db, user_id, updates)


class WorkbenchService:
    def __init__(
        self,
        repository: WorkbenchRepository,
        *,
        active_definition_limit: int,
        total_definition_limit: int,
        registry: WorkbenchTargetRegistry | None = None,
        link_limit: int = LINK_LIMIT,
        link_attributes_limit: int = LINK_ATTRIBUTES_LIMIT,
    ) -> None:
        self._repository = repository
        self._registry = registry or WorkbenchTargetRegistry()
        self._active_definition_limit = active_definition_limit
        self._total_definition_limit = total_definition_limit
        self._link_limit = link_limit
        self._link_attributes_limit = link_attributes_limit

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
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        for link in links:
            _validate_link_attributes_document(payload.local, link_mutable(link))
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

    async def list_links(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        *,
        limit: int,
        cursor: LinkCursor | None = None,
    ) -> AuthorizedLinkPage:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        snapshot_at = cursor.snapshot_at if cursor is not None else datetime.now(UTC)
        links = await self._repository.all_links(db, owner_user_id, definition_id)
        authorized: list[WorkbenchLink] = []
        for link in links:
            if link.updated_at > snapshot_at or (
                cursor is not None and (link.position, link.id) <= (cursor.position, cursor.link_id)
            ):
                continue
            mutable = link_mutable(link)
            if await self._registry.is_link_authorized(db, owner_user_id, mutable):
                authorized.append(link)
        page_links = authorized[:limit]
        next_cursor = None
        if len(authorized) > limit:
            last = page_links[-1]
            next_cursor = LinkCursor(
                snapshot_at=snapshot_at,
                position=last.position,
                link_id=last.id,
            )
        return AuthorizedLinkPage(
            items=[link_response(link, definition.link_set_revision) for link in page_links],
            next_cursor=next_cursor,
            link_set_revision=definition.link_set_revision,
        )

    async def create_link(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchLinkCreateRequest,
        idempotency_key: UUID,
    ) -> WorkbenchObjectLinkResponse:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        _validate_link_attributes(definition, payload.local)
        await self._registry.require_link_authorized(db, owner_user_id, payload.local)
        fingerprint = request_fingerprint(
            LINK_CREATE_OPERATION,
            {"workbenchId": str(definition_id)},
            payload,
        )
        receipt = await self._repository.get_receipt(db, owner_user_id, idempotency_key)
        if receipt is not None:
            return await self._replay_link_create(
                db,
                owner_user_id,
                definition,
                receipt,
                fingerprint,
            )

        if definition.link_set_revision != payload.base_link_set_revision:
            raise _lifecycle_version_conflict()
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        if len(links) >= self._link_limit:
            raise _quota_error()
        if any(
            link.target_kind == payload.local.target.kind
            and link.target_id == payload.local.target.id
            for link in links
        ):
            raise _schema_error("local.target", "target must be unique")
        _require_attribute_quota(links, payload.local, self._link_attributes_limit)

        now = utc_now()
        definition.link_set_revision += 1
        link = WorkbenchLink(
            id=uuid7(),
            workbench_id=definition.id,
            owner_user_id=owner_user_id,
            target_kind=payload.local.target.kind,
            target_id=payload.local.target.id,
            position=payload.local.position,
            primary_context=payload.local.primary_context,
            attributes=_attributes_json(payload.local),
            revision=1,
            created_at=now,
            updated_at=now,
        )
        self._repository.add_link(db, link)
        await db.flush()
        response = link_response(link, definition.link_set_revision)
        self._repository.add_receipt(
            db,
            WorkbenchIdempotencyReceipt(
                owner_user_id=owner_user_id,
                operation=LINK_CREATE_OPERATION,
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

    async def patch_link(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        link_id: UUID,
        payload: WorkbenchLinkPatchRequest,
    ) -> WorkbenchObjectLinkResponse:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        link = await self._owned_link(db, owner_user_id, definition_id, link_id, for_update=True)
        current = link_mutable(link)
        await self._registry.require_link_authorized(db, owner_user_id, current)
        await self._registry.require_link_authorized(db, owner_user_id, payload.local)
        if payload.local.target != current.target:
            raise _schema_error("local.target", "target cannot change")
        _validate_link_attributes(definition, payload.local)
        if link.revision != payload.expected_revision:
            raise _link_version_conflict(link, definition, payload)
        if definition.link_set_revision != payload.base_link_set_revision:
            raise _lifecycle_version_conflict()
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        _require_attribute_quota(
            [candidate for candidate in links if candidate.id != link.id],
            payload.local,
            self._link_attributes_limit,
        )
        _apply_link(link, payload.local)
        link.revision += 1
        definition.link_set_revision += 1
        link.updated_at = utc_now()
        await db.flush()
        return link_response(link, definition.link_set_revision)

    async def delete_link(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        link_id: UUID,
        payload: WorkbenchLinkDeleteRequest,
    ) -> WorkbenchLinkDeleteReceipt:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        link = await self._owned_link(db, owner_user_id, definition_id, link_id, for_update=True)
        current = link_mutable(link)
        await self._registry.require_link_authorized(db, owner_user_id, current)
        if link.revision != payload.expected_revision:
            raise _link_version_conflict(
                link,
                definition,
                WorkbenchLinkPatchRequest(
                    expected_revision=payload.expected_revision,
                    base_link_set_revision=payload.base_link_set_revision,
                    base=payload.base,
                    local=payload.base,
                ),
            )
        if definition.link_set_revision != payload.base_link_set_revision:
            raise _lifecycle_version_conflict()
        deleted_at = utc_now()
        definition.link_set_revision += 1
        await self._repository.delete_link(db, link)
        await db.flush()
        return WorkbenchLinkDeleteReceipt(
            link_id=link_id,
            link_set_revision=definition.link_set_revision,
            deleted_at=deleted_at,
        )

    async def reorder_links(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchLinkReorderRequest,
    ) -> WorkbenchLinkSetResponse:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        for link in links:
            await self._registry.require_link_authorized(db, owner_user_id, link_mutable(link))
        remote = [link.id for link in links]
        if len(links) > self._link_limit:
            raise _schema_error("orderedLinkIds", "link set exceeds limit")
        if len(payload.base_order) != len(set(payload.base_order)) or len(
            payload.ordered_link_ids
        ) != len(set(payload.ordered_link_ids)):
            raise _schema_error("orderedLinkIds", "must contain the complete link set")
        if definition.link_set_revision != payload.base_link_set_revision:
            raise _link_set_version_conflict(
                payload.base_link_set_revision,
                definition.link_set_revision,
                payload.base_order,
                payload.ordered_link_ids,
                remote,
            )
        if not _same_unique_ids(payload.base_order, remote) or not _same_unique_ids(
            payload.ordered_link_ids, remote
        ):
            raise _schema_error("orderedLinkIds", "must contain the complete link set")
        by_id = {link.id: link for link in links}
        now = utc_now()
        for position, link_id_value in enumerate(payload.ordered_link_ids):
            link = by_id[link_id_value]
            if link.position != position:
                link.position = position
                link.updated_at = now
        definition.link_set_revision += 1
        await db.flush()
        return WorkbenchLinkSetResponse(
            link_set_revision=definition.link_set_revision,
            ordered_link_ids=payload.ordered_link_ids,
        )

    async def export_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        *,
        include_links: bool,
    ) -> WorkbenchExportV1:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        links = None
        if include_links:
            links = []
            for link in await self._repository.all_links(db, owner_user_id, definition_id):
                mutable = link_mutable(link)
                if await self._registry.is_link_authorized(db, owner_user_id, mutable):
                    links.append(mutable)
        return WorkbenchExportV1(
            contract="workbench.export",
            schema_version=1,
            document=WorkbenchDefinitionDocumentV1.model_validate(definition.document),
            links=links,
        )

    async def import_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        payload: WorkbenchImportRequest,
        idempotency_key: UUID,
    ) -> WorkbenchImportSucceededReceipt:
        await self._require_locked_owner(db, owner_user_id)
        source_fingerprint = canonical_fingerprint(payload.payload)
        if not hmac.compare_digest(source_fingerprint, payload.source_fingerprint):
            raise _schema_error("sourceFingerprint", "fingerprint mismatch")
        fingerprint = request_fingerprint(
            IMPORT_OPERATION,
            {},
            {"payload": payload.payload.model_dump(mode="json", by_alias=True)},
        )
        receipt = await self._repository.get_receipt(db, owner_user_id, idempotency_key)
        if receipt is not None:
            return _replay_receipt(
                receipt,
                IMPORT_OPERATION,
                fingerprint,
                WorkbenchImportSucceededReceipt,
            )

        counts = await self._repository.count_definitions(db, owner_user_id)
        if (
            counts.active >= self._active_definition_limit
            or counts.total >= self._total_definition_limit
        ):
            raise _quota_error()
        candidates = payload.payload.links or []
        if len(candidates) > self._link_limit:
            raise _quota_error()
        for mutable in candidates:
            _validate_link_attributes_document(payload.payload.document, mutable)
        _require_unique_targets(candidates)

        authorized = []
        for mutable in candidates:
            if await self._registry.is_link_authorized(db, owner_user_id, mutable):
                authorized.append(mutable)
        if _attributes_size(authorized) > self._link_attributes_limit:
            raise _schema_error("payload.links", "attributes exceed quota")

        now = utc_now()
        document = payload.payload.document
        definition = WorkbenchDefinition(
            id=uuid7(),
            owner_user_id=owner_user_id,
            name=document.payload.name,
            description=document.payload.description,
            icon=document.payload.icon,
            accent=document.payload.accent,
            template_id=document.payload.template_id,
            lifecycle="active",
            document=_document_json(document),
            revision=1,
            link_set_revision=1 + len(authorized),
            created_at=now,
            updated_at=now,
        )
        self._repository.add_definition(db, definition)
        await db.flush()
        for mutable in authorized:
            self._repository.add_link(db, _new_link(definition, owner_user_id, mutable, now))
        await db.flush()
        skipped = len(candidates) - len(authorized)
        response = WorkbenchImportSucceededReceipt(
            receipt_id=uuid7(),
            operation="workbench.import.v1",
            idempotency_key=idempotency_key,
            source_fingerprint=source_fingerprint,
            created_at=now,
            skipped_links=(
                WorkbenchSkippedLinks(count=skipped, reason="not_available") if skipped else None
            ),
            status="succeeded",
            retryable=False,
            definition_id=definition.id,
        )
        self._repository.add_receipt(
            db,
            WorkbenchIdempotencyReceipt(
                id=response.receipt_id,
                owner_user_id=owner_user_id,
                operation=IMPORT_OPERATION,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                outcome="succeeded",
                retryable=False,
                definition_id=definition.id,
                response_snapshot=response.model_dump(mode="json", by_alias=True),
                created_at=now,
            ),
        )
        await db.flush()
        return response

    async def deletion_impact(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        *,
        sign_impact: Callable[[dict[str, object]], str],
    ) -> WorkbenchDefinitionDeletionImpact:
        definition = await self._locked_definition(db, owner_user_id, definition_id)
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        preference = await self._repository.get_preference(db, owner_user_id, for_update=True)
        claims = deletion_impact_claims(owner_user_id, definition, len(links), preference)
        return WorkbenchDefinitionDeletionImpact(
            workbench_id=definition.id,
            revision=definition.revision,
            link_set_revision=definition.link_set_revision,
            link_count=len(links),
            preference_will_fallback=_preference_references(preference, definition.id),
            fallback_workbench_id="fixed.learning",
            formal_object_delete_count=0,
            impact_fingerprint=sign_impact(claims),
        )

    async def delete_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        payload: WorkbenchDefinitionDeleteRequest,
        idempotency_key: UUID,
        *,
        verify_impact: Callable[[dict[str, object], str], bool],
    ) -> WorkbenchDefinitionDeleteReceipt:
        await self._require_locked_owner(db, owner_user_id)
        fingerprint = request_fingerprint(
            DELETE_OPERATION,
            {"workbenchId": str(definition_id)},
            payload,
        )
        existing = await self._repository.get_receipt(db, owner_user_id, idempotency_key)
        if existing is not None:
            return _replay_receipt(
                existing,
                DELETE_OPERATION,
                fingerprint,
                WorkbenchDefinitionDeleteReceipt,
            )
        definition = await self._owned_definition(db, owner_user_id, definition_id, for_update=True)
        links = await self._repository.all_links(db, owner_user_id, definition_id, for_update=True)
        preference = await self._repository.get_preference(db, owner_user_id, for_update=True)
        claims = deletion_impact_claims(owner_user_id, definition, len(links), preference)
        if not verify_impact(claims, payload.impact_fingerprint) or (
            definition.revision != payload.expected_revision
            or definition.link_set_revision != payload.expected_link_set_revision
        ):
            raise _lifecycle_version_conflict()
        fallback = _fallback_preference(preference, definition.id)
        now = utc_now()
        response = WorkbenchDefinitionDeleteReceipt(
            receipt_id=uuid7(),
            deleted_definition_id=definition.id,
            deleted_link_count=len(links),
            preference_fallback=fallback,
            deleted_at=now,
        )
        self._repository.add_receipt(
            db,
            WorkbenchIdempotencyReceipt(
                id=response.receipt_id,
                owner_user_id=owner_user_id,
                operation=DELETE_OPERATION,
                idempotency_key=idempotency_key,
                request_fingerprint=fingerprint,
                outcome="succeeded",
                retryable=False,
                definition_id=definition.id,
                response_snapshot=response.model_dump(mode="json", by_alias=True),
                created_at=now,
            ),
        )
        await self._repository.delete_definition(db, owner_user_id, definition.id)
        await db.flush()
        return response

    async def _owned_link(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        link_id: UUID,
        *,
        for_update: bool,
    ) -> WorkbenchLink:
        link = await self._repository.get_link(
            db,
            owner_user_id,
            definition_id,
            link_id,
            for_update=for_update,
        )
        if link is None:
            raise _not_found_error()
        return link

    async def _replay_link_create(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition: WorkbenchDefinition,
        receipt: WorkbenchIdempotencyReceipt,
        fingerprint: str,
    ) -> WorkbenchObjectLinkResponse:
        response = _replay_receipt(
            receipt,
            LINK_CREATE_OPERATION,
            fingerprint,
            WorkbenchObjectLinkResponse,
        )
        link = await self._owned_link(
            db,
            owner_user_id,
            definition.id,
            response.id,
            for_update=False,
        )
        await self._registry.require_link_authorized(db, owner_user_id, link_mutable(link))
        return response


def request_fingerprint(operation: str, resource: dict[str, object], body: Any) -> str:
    body_value = (
        body.model_dump(mode="json", by_alias=True) if hasattr(body, "model_dump") else body
    )
    encoded = rfc8785.dumps(
        cast(Any, {"operation": operation, "resource": resource, "body": body_value})
    )
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def canonical_fingerprint(value: Any) -> str:
    body_value = (
        value.model_dump(mode="json", by_alias=True) if hasattr(value, "model_dump") else value
    )
    return f"sha256:{hashlib.sha256(rfc8785.dumps(cast(Any, body_value))).hexdigest()}"


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


def link_mutable(link: WorkbenchLink) -> WorkbenchLinkMutableV1:
    return WorkbenchLinkMutableV1.model_validate(
        {
            "target": {"kind": link.target_kind, "id": link.target_id},
            "position": link.position,
            "primaryContext": link.primary_context,
            "attributes": link.attributes,
        }
    )


def link_response(link: WorkbenchLink, link_set_revision: int) -> WorkbenchObjectLinkResponse:
    return WorkbenchObjectLinkResponse(
        id=link.id,
        workbench_id=link.workbench_id,
        owner_user_id=link.owner_user_id,
        revision=link.revision,
        link_set_revision=link_set_revision,
        created_at=link.created_at,
        updated_at=link.updated_at,
        mutable=link_mutable(link),
    )


def validate_workbench_preference(
    value: str, expected_revision: int
) -> WorkbenchPreferenceDocumentV1:
    if len(value.encode("utf-8")) > 4096:
        raise _preference_error("value", "value exceeds 4096 UTF-8 bytes")
    try:
        parsed = json.loads(value, object_pairs_hook=_strict_object)
        document = WorkbenchPreferenceDocumentV1.model_validate(parsed)
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise _preference_error("value", "invalid preference document") from error
    if document.revision != expected_revision:
        raise _preference_error("revision", "revision mismatch")
    return document


def _strict_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result or key in {"__proto__", "prototype", "constructor"}:
            raise ValueError("unsafe or duplicate key")
        result[key] = value
    return result


def _validate_link_attributes(
    definition: WorkbenchDefinition,
    mutable: WorkbenchLinkMutableV1,
) -> None:
    _validate_link_attributes_document(
        WorkbenchDefinitionDocumentV1.model_validate(definition.document), mutable
    )


def _validate_link_attributes_document(
    document: WorkbenchDefinitionDocumentV1,
    mutable: WorkbenchLinkMutableV1,
) -> None:
    fields = {field.id: field for field in document.payload.field_definitions}
    for key, value in mutable.attributes.items():
        field = fields.get(key)
        if field is None:
            raise _schema_error(f"local.attributes.{key}", "attribute field is not defined")
        try:
            filter_value = AttributeEqualsFilter.model_validate(
                {"id": "link-value", "kind": "attribute-equals", "fieldId": key, "value": value}
            )
            _validate_filter_value(filter_value, field)
        except ValueError as error:
            raise _schema_error(
                f"local.attributes.{key}", "attribute value does not match field"
            ) from error


def _attributes_json(mutable: WorkbenchLinkMutableV1) -> dict[str, object]:
    dumped = mutable.model_dump(mode="json", by_alias=True)
    return cast(dict[str, object], dumped["attributes"])


def _attributes_size(values: list[WorkbenchLinkMutableV1]) -> int:
    return sum(len(rfc8785.dumps(cast(Any, _attributes_json(value)))) for value in values)


def _require_attribute_quota(
    existing: list[WorkbenchLink],
    candidate: WorkbenchLinkMutableV1,
    limit: int,
) -> None:
    size = sum(len(rfc8785.dumps(cast(Any, link.attributes))) for link in existing)
    size += len(rfc8785.dumps(cast(Any, _attributes_json(candidate))))
    if size > limit:
        raise _schema_error("local.attributes", "attributes exceed quota")


def _require_unique_targets(values: list[WorkbenchLinkMutableV1]) -> None:
    keys = [(value.target.kind, value.target.id) for value in values]
    if len(keys) != len(set(keys)):
        raise _schema_error("payload.links", "targets must be unique")


def _new_link(
    definition: WorkbenchDefinition,
    owner_user_id: UUID,
    mutable: WorkbenchLinkMutableV1,
    now: datetime,
) -> WorkbenchLink:
    return WorkbenchLink(
        id=uuid7(),
        workbench_id=definition.id,
        owner_user_id=owner_user_id,
        target_kind=mutable.target.kind,
        target_id=mutable.target.id,
        position=mutable.position,
        primary_context=mutable.primary_context,
        attributes=_attributes_json(mutable),
        revision=1,
        created_at=now,
        updated_at=now,
    )


def _apply_link(link: WorkbenchLink, mutable: WorkbenchLinkMutableV1) -> None:
    link.position = mutable.position
    link.primary_context = mutable.primary_context
    link.attributes = _attributes_json(mutable)


def _same_unique_ids(candidate: list[UUID], current: list[UUID]) -> bool:
    return len(candidate) == len(set(candidate)) and set(candidate) == set(current)


def _link_version_conflict(
    link: WorkbenchLink,
    definition: WorkbenchDefinition,
    payload: WorkbenchLinkPatchRequest,
) -> APIError:
    remote = link_mutable(link)
    return APIError(
        code="WORKBENCH_VERSION_CONFLICT",
        message="The Workbench changed after it was read.",
        status_code=409,
        details={
            "entity": "link",
            "baseRevision": payload.expected_revision,
            "remoteRevision": link.revision,
            "conflictPaths": _conflict_paths(
                payload.base.model_dump(mode="json", by_alias=True),
                payload.local.model_dump(mode="json", by_alias=True),
                remote.model_dump(mode="json", by_alias=True),
            ),
            "base": payload.base.model_dump(mode="json", by_alias=True),
            "local": payload.local.model_dump(mode="json", by_alias=True),
            "remote": remote.model_dump(mode="json", by_alias=True),
        },
    )


def _link_set_version_conflict(
    base_revision: int,
    remote_revision: int,
    base: list[UUID],
    local: list[UUID],
    remote: list[UUID],
) -> APIError:
    return APIError(
        code="WORKBENCH_VERSION_CONFLICT",
        message="The Workbench changed after it was read.",
        status_code=409,
        details={
            "entity": "link_set",
            "baseRevision": base_revision,
            "remoteRevision": remote_revision,
            "conflictPaths": ["orderedLinkIds"],
            "base": base,
            "local": local,
            "remote": remote,
        },
    )


def _replay_receipt[ResponseModel: BaseModel](
    receipt: WorkbenchIdempotencyReceipt,
    operation: str,
    fingerprint: str,
    response_type: type[ResponseModel],
) -> ResponseModel:
    if receipt.operation != operation or receipt.request_fingerprint != fingerprint:
        raise APIError(
            code="WORKBENCH_IDEMPOTENCY_CONFLICT",
            message="The idempotency key was already used.",
            status_code=409,
        )
    return response_type.model_validate(receipt.response_snapshot)


def _preference_document(setting: UserSetting | None) -> WorkbenchPreferenceDocumentV1 | None:
    if setting is None:
        return None
    try:
        return validate_workbench_preference(setting.value, setting.version)
    except APIError:
        return None


def _preference_references(setting: UserSetting | None, definition_id: UUID) -> bool:
    document = _preference_document(setting)
    if document is None:
        return False
    key = str(definition_id)
    payload = document.payload.model_dump(mode="json", by_alias=True)
    return (
        payload["activeWorkbenchId"] == key
        or key in cast(list[str], payload["workbenchOrder"])
        or key in cast(dict[str, object], payload["defaultViewByWorkbench"])
        or key in cast(dict[str, object], payload["defaultSpaceByWorkbench"])
    )


def deletion_impact_claims(
    owner_user_id: UUID,
    definition: WorkbenchDefinition,
    link_count: int,
    preference: UserSetting | None,
) -> dict[str, object]:
    return {
        "ownerUserId": str(owner_user_id),
        "workbenchId": str(definition.id),
        "revision": definition.revision,
        "linkSetRevision": definition.link_set_revision,
        "linkCount": link_count,
        "preferenceWillFallback": _preference_references(preference, definition.id),
        "fallbackWorkbenchId": "fixed.learning",
        "formalObjectDeleteCount": 0,
    }


def _fallback_preference(setting: UserSetting | None, definition_id: UUID) -> bool:
    document = _preference_document(setting)
    if setting is None or document is None:
        return False
    key = str(definition_id)
    value = document.model_dump(mode="json", by_alias=True)
    payload = cast(dict[str, Any], value["payload"])
    changed = False
    if payload["activeWorkbenchId"] == key:
        payload["activeWorkbenchId"] = "fixed.learning"
        changed = True
    order = cast(list[str], payload["workbenchOrder"])
    if key in order:
        payload["workbenchOrder"] = [item for item in order if item != key]
        changed = True
    for field in ("defaultViewByWorkbench", "defaultSpaceByWorkbench"):
        mapping = cast(dict[str, object], payload[field])
        if key in mapping:
            del mapping[key]
            changed = True
    if changed:
        value["revision"] = setting.version + 1
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        validate_workbench_preference(encoded, setting.version + 1)
        setting.value = encoded
        setting.version += 1
    return changed


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


def _schema_error(path: str = "baseLifecycle", rule: str = "lifecycle transition") -> APIError:
    return APIError(
        code="WORKBENCH_SCHEMA_INVALID",
        message="The Workbench request is invalid.",
        status_code=422,
        details={"issues": [{"path": path.split("."), "rule": rule}]},
    )


def _preference_error(path: str, rule: str) -> APIError:
    return APIError(
        code="WORKBENCH_PREFERENCE_INVALID",
        message="The Workbench preference is invalid.",
        status_code=422,
        details={"issues": [{"path": path.split("."), "rule": rule}]},
    )
