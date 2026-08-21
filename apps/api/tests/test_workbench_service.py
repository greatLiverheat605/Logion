from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
import rfc8785
from logion_api.db import session_factory
from logion_api.errors import APIError
from logion_api.identity.models import User
from logion_api.users.models import UserSetting
from logion_api.users.schemas import UserSettingWrite
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
    WorkbenchLink,
)
from logion_api.workbenches.registry import WorkbenchTargetRegistry
from logion_api.workbenches.repository import (
    DefinitionCounts,
    DefinitionPage,
    LinkCursor,
    LinkPage,
    WorkbenchRepository,
)
from logion_api.workbenches.schemas import (
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDeleteRequest,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionReplaceRequest,
    WorkbenchExportV1,
    WorkbenchImportRequest,
    WorkbenchLinkCreateRequest,
    WorkbenchLinkMutableV1,
    WorkbenchLinkReorderRequest,
)
from logion_api.workbenches.service import (
    CREATE_OPERATION,
    LINK_CREATE_OPERATION,
    WorkbenchService,
    WorkbenchUserSettingService,
    _conflict_paths,
    _require_attribute_quota,
    canonical_fingerprint,
    definition_response,
    request_fingerprint,
    validate_workbench_preference,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


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


def _document_with_module(title: str) -> WorkbenchDefinitionDocumentV1:
    value = _document().model_dump(mode="json", by_alias=True)
    payload = cast(dict[str, Any], value["payload"])
    payload["modules"] = [{"id": "task-queue", "kind": "task-queue", "title": title}]
    payload["layout"] = {
        "columns": 1,
        "items": [
            {
                "moduleId": "task-queue",
                "region": "main",
                "order": 0,
                "span": 1,
            }
        ],
    }
    return WorkbenchDefinitionDocumentV1.model_validate(value)


def _document_with_text_field() -> WorkbenchDefinitionDocumentV1:
    value = _document().model_dump(mode="json", by_alias=True)
    payload = cast(dict[str, Any], value["payload"])
    payload["fieldDefinitions"] = [
        {
            "id": "summary",
            "label": "Summary",
            "required": False,
            "type": "text",
            "maxLength": 80,
        }
    ]
    return WorkbenchDefinitionDocumentV1.model_validate(value)


def _definition(owner_id: UUID, *, revision: int = 1, lifecycle: str = "active") -> Any:
    now = datetime.now(UTC)
    document = _document()
    return WorkbenchDefinition(
        id=uuid4(),
        owner_user_id=owner_id,
        name=document.payload.name,
        description=document.payload.description,
        icon=document.payload.icon,
        accent=document.payload.accent,
        template_id=document.payload.template_id,
        lifecycle=lifecycle,
        document=document.model_dump(mode="json", by_alias=True),
        revision=revision,
        link_set_revision=1,
        created_at=now,
        updated_at=now,
    )


def _service(repository: WorkbenchRepository) -> WorkbenchService:
    return WorkbenchService(
        repository,
        active_definition_limit=20,
        total_definition_limit=50,
    )


def _repository() -> WorkbenchRepository:
    repository = WorkbenchRepository()
    repository.lock_owner = AsyncMock(return_value=True)  # type: ignore[method-assign]
    repository.get_receipt = AsyncMock(return_value=None)  # type: ignore[method-assign]
    repository.get_definition = AsyncMock(return_value=None)  # type: ignore[method-assign]
    repository.count_definitions = AsyncMock(  # type: ignore[method-assign]
        return_value=DefinitionCounts(active=0, total=0)
    )
    repository.list_definitions = AsyncMock(  # type: ignore[method-assign]
        return_value=DefinitionPage(items=[], next_cursor=None)
    )
    repository.get_link = AsyncMock(return_value=None)  # type: ignore[method-assign]
    repository.list_links = AsyncMock(  # type: ignore[method-assign]
        return_value=LinkPage(items=[], next_cursor=None)
    )
    repository.all_links = AsyncMock(return_value=[])  # type: ignore[method-assign]
    repository.get_preference = AsyncMock(return_value=None)  # type: ignore[method-assign]
    repository.delete_definition = AsyncMock()  # type: ignore[method-assign]
    repository.delete_link = AsyncMock()  # type: ignore[method-assign]
    repository.add_definition = Mock()  # type: ignore[method-assign]
    repository.add_link = Mock()  # type: ignore[method-assign]
    repository.add_receipt = Mock()  # type: ignore[method-assign]
    return repository


def _db() -> AsyncSession:
    return cast(AsyncSession, AsyncMock(spec=AsyncSession))


def _link(kind: str = "task", target_id: UUID | None = None, position: int = 0) -> Any:
    return WorkbenchLinkMutableV1.model_validate(
        {
            "target": {"kind": kind, "id": str(target_id or uuid4())},
            "position": position,
            "primaryContext": False,
            "attributes": {},
        }
    )


def _link_row(owner_id: UUID, definition_id: UUID, mutable: Any) -> WorkbenchLink:
    now = datetime.now(UTC)
    return WorkbenchLink(
        id=uuid4(),
        workbench_id=definition_id,
        owner_user_id=owner_id,
        target_kind=mutable.target.kind,
        target_id=mutable.target.id,
        position=mutable.position,
        primary_context=mutable.primary_context,
        attributes=mutable.model_dump(mode="json", by_alias=True)["attributes"],
        revision=1,
        created_at=now,
        updated_at=now,
    )


def _service_with_registry(
    repository: WorkbenchRepository,
) -> tuple[WorkbenchService, WorkbenchTargetRegistry]:
    registry = WorkbenchTargetRegistry()
    registry.is_link_authorized = AsyncMock(return_value=True)  # type: ignore[method-assign]
    registry.require_link_authorized = AsyncMock()  # type: ignore[method-assign]
    return (
        WorkbenchService(
            repository,
            active_definition_limit=20,
            total_definition_limit=50,
            registry=registry,
        ),
        registry,
    )


@pytest.mark.asyncio
async def test_create_is_owner_locked_snapshotted_and_exactly_replayed() -> None:
    owner_id, key = uuid4(), uuid4()
    repository = _repository()
    db = _db()
    payload = WorkbenchDefinitionCreateRequest(document=_document())
    created = await _service(repository).create_definition(db, owner_id, payload, key)

    repository.lock_owner.assert_awaited_once_with(db, owner_id)  # type: ignore[attr-defined]
    repository.add_definition.assert_called_once()  # type: ignore[attr-defined]
    receipt = repository.add_receipt.call_args.args[1]  # type: ignore[attr-defined]
    assert receipt.operation == CREATE_OPERATION
    assert receipt.definition_id == created.id
    assert receipt.response_snapshot == created.model_dump(mode="json", by_alias=True)

    repository.get_receipt.return_value = receipt  # type: ignore[attr-defined]
    repository.get_definition.return_value = repository.add_definition.call_args.args[1]  # type: ignore[attr-defined]
    replayed = await _service(repository).create_definition(db, owner_id, payload, key)
    assert replayed == created
    assert repository.add_definition.call_count == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_create_rejects_cross_operation_or_changed_fingerprint_without_disclosure() -> None:
    owner_id, key = uuid4(), uuid4()
    repository = _repository()
    payload = WorkbenchDefinitionCreateRequest(document=_document())
    repository.get_receipt.return_value = WorkbenchIdempotencyReceipt(  # type: ignore[attr-defined]
        owner_user_id=owner_id,
        operation="workbench.link.create.v1",
        idempotency_key=key,
        request_fingerprint="sha256:" + "0" * 64,
        outcome="succeeded",
        retryable=False,
        response_snapshot={},
    )

    with pytest.raises(APIError) as raised:
        await _service(repository).create_definition(_db(), owner_id, payload, key)
    assert raised.value.code == "WORKBENCH_IDEMPOTENCY_CONFLICT"
    assert raised.value.details == {}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "counts",
    [DefinitionCounts(active=20, total=20), DefinitionCounts(active=3, total=50)],
)
async def test_create_enforces_active_and_total_limits_without_returning_counts(
    counts: DefinitionCounts,
) -> None:
    repository = _repository()
    repository.count_definitions.return_value = counts  # type: ignore[attr-defined]
    with pytest.raises(APIError) as raised:
        await _service(repository).create_definition(
            _db(),
            uuid4(),
            WorkbenchDefinitionCreateRequest(document=_document()),
            uuid4(),
        )
    assert raised.value.code == "WORKBENCH_RATE_LIMITED"
    assert raised.value.details == {}
    repository.add_definition.assert_not_called()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_get_is_strictly_owner_scoped_and_returns_opaque_not_found() -> None:
    repository = _repository()
    with pytest.raises(APIError) as raised:
        await _service(repository).get_definition(_db(), uuid4(), uuid4())
    assert raised.value.code == "RESOURCE_NOT_FOUND"
    assert raised.value.details == {}


@pytest.mark.asyncio
async def test_list_delegates_owner_filter_and_preserves_snapshot_cursor() -> None:
    owner_id = uuid4()
    repository = _repository()
    service = _service(repository)
    first = await service.list_definitions(_db(), owner_id, lifecycle="active", limit=25)
    assert first.items == []
    call = repository.list_definitions.await_args  # type: ignore[attr-defined]
    assert call.args[1] == owner_id
    assert call.kwargs["lifecycle"] == "active"
    assert call.kwargs["limit"] == 25
    assert call.kwargs["cursor"] is None
    assert call.kwargs["snapshot_at"].tzinfo is not None


@pytest.mark.asyncio
async def test_replace_writes_only_local_and_increments_revision() -> None:
    owner_id = uuid4()
    repository = _repository()
    current = _definition(owner_id, revision=4)
    repository.get_definition.return_value = current  # type: ignore[attr-defined]
    payload = WorkbenchDefinitionReplaceRequest(
        expected_revision=4,
        base=_document(),
        local=_document("Updated desk"),
    )
    result = await _service(repository).replace_definition(_db(), owner_id, current.id, payload)
    assert result.revision == 5
    assert result.name == "Updated desk"
    assert current.document == payload.local.model_dump(mode="json", by_alias=True)


@pytest.mark.asyncio
async def test_replace_rejects_definition_that_invalidates_existing_link_attributes() -> None:
    owner_id = uuid4()
    repository = _repository()
    current = _definition(owner_id)
    current.document = _document_with_text_field().model_dump(mode="json", by_alias=True)
    mutable = _link()
    mutable.attributes["summary"] = "kept"
    repository.get_definition.return_value = current  # type: ignore[attr-defined]
    repository.all_links.return_value = [  # type: ignore[attr-defined]
        _link_row(owner_id, current.id, mutable)
    ]

    with pytest.raises(APIError) as raised:
        await _service(repository).replace_definition(
            _db(),
            owner_id,
            current.id,
            WorkbenchDefinitionReplaceRequest(
                expected_revision=1,
                base=_document_with_text_field(),
                local=_document(),
            ),
        )

    assert raised.value.code == "WORKBENCH_SCHEMA_INVALID"
    assert current.revision == 1
    assert WorkbenchDefinitionDocumentV1.model_validate(current.document).payload.field_definitions
    assert repository.all_links.await_args.kwargs["for_update"] is True  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_replace_conflict_returns_bounded_three_way_context_after_owner_resolution() -> None:
    owner_id = uuid4()
    repository = _repository()
    current = _definition(owner_id, revision=5)
    current.name = "Remote desk"
    current.document = _document("Remote desk").model_dump(mode="json", by_alias=True)
    repository.get_definition.return_value = current  # type: ignore[attr-defined]
    payload = WorkbenchDefinitionReplaceRequest(
        expected_revision=4,
        base=_document(),
        local=_document("Local desk"),
    )

    with pytest.raises(APIError) as raised:
        await _service(repository).replace_definition(_db(), owner_id, current.id, payload)
    assert raised.value.code == "WORKBENCH_VERSION_CONFLICT"
    assert raised.value.details["baseRevision"] == 4
    assert raised.value.details["remoteRevision"] == 5
    assert raised.value.details["conflictPaths"] == ["payload.name"]


@pytest.mark.asyncio
async def test_replace_conflict_identifies_keyed_module_instead_of_whole_array() -> None:
    owner_id = uuid4()
    repository = _repository()
    current = _definition(owner_id, revision=5)
    current.document = _document_with_module("Remote").model_dump(mode="json", by_alias=True)
    repository.get_definition.return_value = current  # type: ignore[attr-defined]
    payload = WorkbenchDefinitionReplaceRequest(
        expected_revision=4,
        base=_document_with_module("Base"),
        local=_document_with_module("Local"),
    )

    with pytest.raises(APIError) as raised:
        await _service(repository).replace_definition(_db(), owner_id, current.id, payload)
    assert raised.value.details["conflictPaths"] == ["payload.modules[task-queue].title"]


@pytest.mark.asyncio
async def test_archive_then_restore_rechecks_active_quota() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    service = _service(repository)

    archived = await service.archive_definition(
        _db(),
        owner_id,
        definition.id,
        WorkbenchDefinitionLifecycleRequest(expected_revision=1, base_lifecycle="active"),
    )
    assert archived.lifecycle == "archived"
    assert archived.revision == 2

    repository.count_definitions.return_value = DefinitionCounts(active=20, total=21)  # type: ignore[attr-defined]
    with pytest.raises(APIError) as raised:
        await service.restore_definition(
            _db(),
            owner_id,
            definition.id,
            WorkbenchDefinitionLifecycleRequest(
                expected_revision=2,
                base_lifecycle="archived",
            ),
        )
    assert raised.value.code == "WORKBENCH_RATE_LIMITED"
    assert definition.lifecycle == "archived"


@pytest.mark.asyncio
async def test_lifecycle_owner_resolution_precedes_transition_validation() -> None:
    repository = _repository()
    with pytest.raises(APIError) as raised:
        await _service(repository).archive_definition(
            _db(),
            uuid4(),
            uuid4(),
            WorkbenchDefinitionLifecycleRequest(
                expected_revision=1,
                base_lifecycle="archived",
            ),
        )
    assert raised.value.code == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_lifecycle_conflict_reports_the_actual_expected_revision() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id, revision=5)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]

    with pytest.raises(APIError) as raised:
        await _service(repository).archive_definition(
            _db(),
            owner_id,
            definition.id,
            WorkbenchDefinitionLifecycleRequest(
                expected_revision=4,
                base_lifecycle="active",
            ),
        )
    assert raised.value.code == "WORKBENCH_VERSION_CONFLICT"
    assert raised.value.details == {}


def test_conflict_paths_are_unique_and_bounded() -> None:
    base = {f"field-{index:03d}": 0 for index in range(130)}
    local = {key: 1 for key in base}
    remote = {key: 2 for key in base}

    paths = _conflict_paths(base, local, remote)

    assert len(paths) == 128
    assert len(paths) == len(set(paths))
    assert all(len(path) <= 256 for path in paths)

    shared_prefix = "x" * 256
    colliding_paths = _conflict_paths(
        {f"{shared_prefix}a": 0, f"{shared_prefix}b": 0},
        {f"{shared_prefix}a": 1, f"{shared_prefix}b": 1},
        {f"{shared_prefix}a": 2, f"{shared_prefix}b": 2},
    )
    assert colliding_paths == [shared_prefix]


def test_rfc8785_fingerprint_is_stable_for_key_order_and_unicode() -> None:
    left = request_fingerprint(
        CREATE_OPERATION,
        {},
        {"name": "研究", "nested": {"b": 2, "a": 1}},
    )
    right = request_fingerprint(
        CREATE_OPERATION,
        {},
        {"nested": {"a": 1, "b": 2}, "name": "研究"},
    )
    assert left == right
    assert left.startswith("sha256:")
    assert len(left) == 71


def test_definition_response_does_not_share_mutable_document_state() -> None:
    owner_id = uuid4()
    definition = _definition(owner_id)
    response = definition_response(definition)
    cast(dict[str, Any], definition.document)["contract"] = "changed"
    assert response.document.contract == "workbench.definition"


@pytest.mark.asyncio
async def test_link_create_reauthorizes_then_atomically_advances_collection() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    service, registry = _service_with_registry(repository)
    payload = WorkbenchLinkCreateRequest(base_link_set_revision=1, local=_link())

    response = await service.create_link(_db(), owner_id, definition.id, payload, uuid4())

    registry.require_link_authorized.assert_awaited_once()  # type: ignore[attr-defined]
    assert response.revision == 1
    assert response.link_set_revision == 2
    assert definition.link_set_revision == 2
    repository.add_link.assert_called_once()  # type: ignore[attr-defined]
    repository.add_receipt.assert_called_once()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_link_list_preserves_cursor_snapshot_and_filters_current_acl() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    denied = _link_row(owner_id, definition.id, _link(position=0))
    allowed = _link_row(owner_id, definition.id, _link(position=1))
    next_allowed = _link_row(owner_id, definition.id, _link(position=2))
    snapshot = datetime.now(UTC)
    for link in (denied, allowed, next_allowed):
        link.updated_at = snapshot - timedelta(seconds=1)
    cursor = LinkCursor(snapshot_at=snapshot, position=-1, link_id=uuid4())
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    repository.all_links.return_value = [denied, allowed, next_allowed]  # type: ignore[attr-defined]
    service, registry = _service_with_registry(repository)
    registry.is_link_authorized.side_effect = [False, True, True]  # type: ignore[attr-defined]

    page = await service.list_links(_db(), owner_id, definition.id, limit=1, cursor=cursor)

    assert [item.id for item in page.items] == [allowed.id]
    assert page.next_cursor == LinkCursor(
        snapshot_at=snapshot, position=allowed.position, link_id=allowed.id
    )
    assert page.link_set_revision == 1
    repository.list_links.assert_not_awaited()  # type: ignore[attr-defined]

    repository.all_links.return_value = [denied]  # type: ignore[attr-defined]
    registry.is_link_authorized.side_effect = [False]  # type: ignore[attr-defined]
    empty = await service.list_links(_db(), owner_id, definition.id, limit=1, cursor=cursor)
    assert empty.items == []
    assert empty.next_cursor is None


@pytest.mark.asyncio
async def test_link_create_authorization_precedes_collection_version_disclosure() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    service, registry = _service_with_registry(repository)
    registry.require_link_authorized.side_effect = APIError(  # type: ignore[attr-defined]
        code="RESOURCE_NOT_FOUND", message="Workbench not found.", status_code=404
    )

    with pytest.raises(APIError) as raised:
        await service.create_link(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkCreateRequest(base_link_set_revision=99, local=_link()),
            uuid4(),
        )
    assert raised.value.code == "RESOURCE_NOT_FOUND"
    repository.all_links.assert_not_awaited()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_link_create_authorization_precedes_idempotency_conflict() -> None:
    owner_id, key = uuid4(), uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    repository.get_receipt.return_value = WorkbenchIdempotencyReceipt(  # type: ignore[attr-defined]
        owner_user_id=owner_id,
        operation=LINK_CREATE_OPERATION,
        idempotency_key=key,
        request_fingerprint="sha256:" + "0" * 64,
        outcome="succeeded",
        retryable=False,
        response_snapshot={},
    )
    service, registry = _service_with_registry(repository)
    registry.require_link_authorized.side_effect = APIError(  # type: ignore[attr-defined]
        code="RESOURCE_NOT_FOUND", message="Workbench not found.", status_code=404
    )

    with pytest.raises(APIError) as raised:
        await service.create_link(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkCreateRequest(base_link_set_revision=1, local=_link()),
            key,
        )

    assert raised.value.code == "RESOURCE_NOT_FOUND"
    assert raised.value.details == {}
    repository.get_receipt.assert_not_awaited()  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_link_create_rejects_undefined_attributes_and_exact_500_limit() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    service, _ = _service_with_registry(repository)
    value = _link().model_dump(mode="json", by_alias=True)
    value["attributes"] = {"missing": "value"}

    with pytest.raises(APIError) as raised:
        await service.create_link(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkCreateRequest(
                base_link_set_revision=1,
                local=WorkbenchLinkMutableV1.model_validate(value),
            ),
            uuid4(),
        )
    assert raised.value.code == "WORKBENCH_SCHEMA_INVALID"

    repository.all_links.return_value = [  # type: ignore[attr-defined]
        _link_row(owner_id, definition.id, _link(target_id=uuid4(), position=index % 500))
        for index in range(500)
    ]
    with pytest.raises(APIError) as raised:
        await service.create_link(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkCreateRequest(base_link_set_revision=1, local=_link()),
            uuid4(),
        )
    assert raised.value.code == "WORKBENCH_RATE_LIMITED"


@pytest.mark.asyncio
async def test_reorder_distinguishes_stale_collection_from_invalid_complete_set() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    first = _link_row(owner_id, definition.id, _link(position=0))
    second = _link_row(owner_id, definition.id, _link(position=1))
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    repository.all_links.return_value = [first, second]  # type: ignore[attr-defined]
    service, _ = _service_with_registry(repository)

    definition.link_set_revision = 3
    with pytest.raises(APIError) as stale:
        await service.reorder_links(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkReorderRequest(
                base_link_set_revision=2,
                base_order=[first.id],
                ordered_link_ids=[first.id],
            ),
        )
    assert stale.value.code == "WORKBENCH_VERSION_CONFLICT"
    assert stale.value.details["remote"] == [first.id, second.id]

    with pytest.raises(APIError) as invalid:
        await service.reorder_links(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkReorderRequest(
                base_link_set_revision=3,
                base_order=[first.id],
                ordered_link_ids=[first.id],
            ),
        )
    assert invalid.value.code == "WORKBENCH_SCHEMA_INVALID"


@pytest.mark.asyncio
async def test_reorder_reauthorizes_complete_link_set_before_conflict_disclosure() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    link = _link_row(owner_id, definition.id, _link())
    definition.link_set_revision = 3
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    repository.all_links.return_value = [link]  # type: ignore[attr-defined]
    service, registry = _service_with_registry(repository)
    registry.require_link_authorized.side_effect = APIError(  # type: ignore[attr-defined]
        code="RESOURCE_NOT_FOUND", message="Workbench not found.", status_code=404
    )

    with pytest.raises(APIError) as raised:
        await service.reorder_links(
            _db(),
            owner_id,
            definition.id,
            WorkbenchLinkReorderRequest(
                base_link_set_revision=2,
                base_order=[link.id],
                ordered_link_ids=[link.id],
            ),
        )

    assert raised.value.code == "RESOURCE_NOT_FOUND"
    assert raised.value.details == {}
    assert definition.link_set_revision == 3


@pytest.mark.asyncio
async def test_import_validates_source_fingerprint_and_aggregates_unavailable_links() -> None:
    owner_id = uuid4()
    repository = _repository()
    service, registry = _service_with_registry(repository)
    registry.is_link_authorized.side_effect = [True, False]  # type: ignore[attr-defined]
    exported = WorkbenchExportV1(
        contract="workbench.export",
        schema_version=1,
        document=_document(),
        links=[_link(position=0), _link(kind="note", position=1)],
    )
    payload = WorkbenchImportRequest(
        source_fingerprint=canonical_fingerprint(exported),
        payload=exported,
    )

    result = await service.import_definition(_db(), owner_id, payload, uuid4())

    assert result.status == "succeeded"
    assert result.skipped_links is not None
    assert result.skipped_links.count == 1
    assert repository.add_definition.call_count == 1  # type: ignore[attr-defined]
    assert repository.add_link.call_count == 1  # type: ignore[attr-defined]
    assert repository.add_receipt.call_count == 1  # type: ignore[attr-defined]

    changed = payload.model_copy(update={"source_fingerprint": "sha256:" + "0" * 64})
    with pytest.raises(APIError) as raised:
        await service.import_definition(_db(), owner_id, changed, uuid4())
    assert raised.value.code == "WORKBENCH_SCHEMA_INVALID"


@pytest.mark.asyncio
async def test_deletion_impact_is_signed_and_verified_under_current_locked_state() -> None:
    owner_id = uuid4()
    repository = _repository()
    definition = _definition(owner_id)
    repository.get_definition.return_value = definition  # type: ignore[attr-defined]
    preference_value = {
        "contract": "workbench.preference",
        "schemaVersion": 1,
        "revision": 1,
        "payload": {
            "activeWorkbenchId": str(definition.id),
            "hiddenFixedWorkbenchIds": [],
            "workbenchOrder": ["fixed.learning", str(definition.id)],
            "density": "compact",
            "defaultViewByWorkbench": {str(definition.id): "board"},
            "defaultSpaceByWorkbench": {},
        },
    }
    setting = UserSetting(
        user_id=owner_id,
        key="workbench.preference",
        value=json.dumps(preference_value),
        version=1,
    )
    repository.get_preference.return_value = setting  # type: ignore[attr-defined]
    service = _service(repository)
    signed: dict[str, object] = {}

    def sign(claims: dict[str, object]) -> str:
        signed.update(claims)
        return "active.signature"

    impact = await service.deletion_impact(_db(), owner_id, definition.id, sign_impact=sign)
    assert impact.preference_will_fallback is True
    assert signed["ownerUserId"] == str(owner_id)
    assert signed["formalObjectDeleteCount"] == 0

    payload = WorkbenchDefinitionDeleteRequest(
        expected_revision=definition.revision,
        expected_link_set_revision=definition.link_set_revision,
        impact_fingerprint=impact.impact_fingerprint,
    )
    receipt = await service.delete_definition(
        _db(),
        owner_id,
        definition.id,
        payload,
        uuid4(),
        verify_impact=lambda claims, signature: (
            claims == signed and signature == "active.signature"
        ),
    )
    assert receipt.preference_fallback is True
    assert setting.version == 2
    assert str(definition.id) not in setting.value
    repository.delete_definition.assert_awaited_once()  # type: ignore[attr-defined]


def test_preference_enforces_exact_4096_utf8_byte_limit() -> None:
    value = json.dumps(
        {
            "contract": "workbench.preference",
            "schemaVersion": 1,
            "revision": 1,
            "payload": {
                "activeWorkbenchId": "fixed.learning",
                "hiddenFixedWorkbenchIds": [],
                "workbenchOrder": ["fixed.learning"],
                "density": "compact",
                "defaultViewByWorkbench": {},
                "defaultSpaceByWorkbench": {},
            },
        }
    )
    exact = " " * (4096 - len(value.encode("utf-8"))) + value
    assert validate_workbench_preference(exact, 1).revision == 1
    with pytest.raises(APIError) as raised:
        validate_workbench_preference(" " + exact, 1)
    assert raised.value.code == "WORKBENCH_PREFERENCE_INVALID"


def test_preference_accepts_every_fixed_workbench_reference() -> None:
    value = json.dumps(
        {
            "contract": "workbench.preference",
            "schemaVersion": 1,
            "revision": 1,
            "payload": {
                "activeWorkbenchId": "fixed.exam",
                "hiddenFixedWorkbenchIds": ["fixed.mentor"],
                "workbenchOrder": [
                    "fixed.learning",
                    "fixed.research",
                    "fixed.exam",
                    "fixed.mentor",
                ],
                "density": "comfortable",
                "defaultViewByWorkbench": {},
                "defaultSpaceByWorkbench": {},
            },
        }
    )

    assert validate_workbench_preference(value, 1).payload.active_workbench_id == "fixed.exam"


@pytest.mark.asyncio
async def test_preference_adapter_rejects_before_existing_setting_service_write() -> None:
    db = _db()
    with pytest.raises(APIError) as raised:
        await WorkbenchUserSettingService().update(
            db,
            uuid4(),
            [UserSettingWrite(key="workbench.preference", value="{}", version=0)],
        )
    assert raised.value.code == "WORKBENCH_PREFERENCE_INVALID"
    db.scalars.assert_not_awaited()  # type: ignore[attr-defined]


def test_link_attributes_enforce_exact_16kib_aggregate_limit() -> None:
    owner_id, definition_id = uuid4(), uuid4()
    candidate = _link()
    candidate_size = len(
        rfc8785.dumps(candidate.model_dump(mode="json", by_alias=True)["attributes"])
    )
    base_size = len(rfc8785.dumps({"note": ""}))
    content_size = 16 * 1024 - candidate_size - 9 * base_size
    chunk, remainder = divmod(content_size, 9)
    existing = []
    for index in range(9):
        row = _link_row(owner_id, definition_id, _link(position=index))
        row.attributes = {"note": "x" * (chunk + (1 if index < remainder else 0))}
        existing.append(row)
    _require_attribute_quota(existing, candidate, 16 * 1024)

    cast(dict[str, str], existing[0].attributes)["note"] += "x"
    with pytest.raises(APIError) as raised:
        _require_attribute_quota(existing, candidate, 16 * 1024)
    assert raised.value.code == "WORKBENCH_SCHEMA_INVALID"


async def _create_user(label: str) -> UUID:
    user_id = uuid4()
    async with session_factory() as db:
        db.add(
            User(
                id=user_id,
                email=f"c6-s1-{label}-{user_id}@example.test",
                email_normalized=f"c6-s1-{label}-{user_id}@example.test",
            )
        )
        await db.commit()
    return user_id


async def _create_definition(owner_id: UUID, label: str) -> WorkbenchDefinition:
    definition = cast(WorkbenchDefinition, _definition(owner_id))
    definition.name = label
    async with session_factory() as db:
        db.add(definition)
        await db.commit()
    return definition


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_concurrent_link_create_writes_once_and_advances_once() -> None:
    owner_id = await _create_user("link-concurrent")
    definition = await _create_definition(owner_id, "Link concurrency")
    key = uuid4()
    payload = WorkbenchLinkCreateRequest(base_link_set_revision=1, local=_link())
    registry = WorkbenchTargetRegistry()
    registry.require_link_authorized = AsyncMock()  # type: ignore[method-assign]

    async def create() -> UUID:
        async with session_factory() as db:
            response = await WorkbenchService(
                WorkbenchRepository(),
                active_definition_limit=20,
                total_definition_limit=50,
                registry=registry,
            ).create_link(db, owner_id, definition.id, payload, key)
            await db.commit()
            return response.id

    first, second = await asyncio.gather(create(), create())
    assert first == second
    async with session_factory() as db:
        persisted = await db.get(WorkbenchDefinition, definition.id)
        assert persisted is not None
        assert persisted.link_set_revision == 2
        assert (
            await db.scalar(
                select(func.count(WorkbenchLink.id)).where(
                    WorkbenchLink.workbench_id == definition.id
                )
            )
            == 1
        )
        assert (
            await db.scalar(
                select(func.count(WorkbenchIdempotencyReceipt.id)).where(
                    WorkbenchIdempotencyReceipt.owner_user_id == owner_id,
                    WorkbenchIdempotencyReceipt.idempotency_key == key,
                )
            )
            == 1
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_delete_cascades_links_and_commits_preference_with_receipt() -> None:
    owner_id = await _create_user("delete")
    definition = await _create_definition(owner_id, "Delete transaction")
    link = _link_row(owner_id, definition.id, _link())
    preference = UserSetting(
        user_id=owner_id,
        key="workbench.preference",
        value=json.dumps(
            {
                "contract": "workbench.preference",
                "schemaVersion": 1,
                "revision": 1,
                "payload": {
                    "activeWorkbenchId": str(definition.id),
                    "hiddenFixedWorkbenchIds": [],
                    "workbenchOrder": ["fixed.learning", str(definition.id)],
                    "density": "compact",
                    "defaultViewByWorkbench": {},
                    "defaultSpaceByWorkbench": {},
                },
            }
        ),
        version=1,
    )
    async with session_factory() as db:
        definition_row = await db.get(WorkbenchDefinition, definition.id)
        assert definition_row is not None
        definition_row.link_set_revision = 2
        db.add_all((link, preference))
        await db.commit()

    key = uuid4()
    async with session_factory() as db:
        receipt = await _service(WorkbenchRepository()).delete_definition(
            db,
            owner_id,
            definition.id,
            WorkbenchDefinitionDeleteRequest(
                expected_revision=1,
                expected_link_set_revision=2,
                impact_fingerprint="signed-impact",
            ),
            key,
            verify_impact=lambda _claims, signature: signature == "signed-impact",
        )
        await db.commit()

    async with session_factory() as db:
        assert await db.get(WorkbenchDefinition, definition.id) is None
        assert await db.get(WorkbenchLink, link.id) is None
        stored_receipt = await db.get(WorkbenchIdempotencyReceipt, receipt.receipt_id)
        assert stored_receipt is not None
        stored_preference = await db.get(UserSetting, (owner_id, "workbench.preference"))
        assert stored_preference is not None
        assert stored_preference.version == 2
        assert str(definition.id) not in stored_preference.value


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_concurrent_create_replays_one_definition_and_receipt() -> None:
    owner_id = await _create_user("concurrent")
    key = uuid4()
    payload = WorkbenchDefinitionCreateRequest(document=_document())

    async def create() -> UUID:
        async with session_factory() as db:
            response = await _service(WorkbenchRepository()).create_definition(
                db, owner_id, payload, key
            )
            await db.commit()
            return response.id

    first, second = await asyncio.gather(create(), create())
    assert first == second
    async with session_factory() as db:
        assert (
            await db.scalar(
                select(func.count(WorkbenchDefinition.id)).where(
                    WorkbenchDefinition.owner_user_id == owner_id
                )
            )
            == 1
        )
        assert (
            await db.scalar(
                select(func.count(WorkbenchIdempotencyReceipt.id)).where(
                    WorkbenchIdempotencyReceipt.owner_user_id == owner_id
                )
            )
            == 1
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_enforces_exact_active_total_restore_and_owner_boundaries() -> None:
    owner_id = await _create_user("quota")
    other_owner_id = await _create_user("other")
    now = datetime.now(UTC)
    seeded = [
        WorkbenchDefinition(
            id=uuid4(),
            owner_user_id=owner_id,
            name=f"Desk {index}",
            description="",
            icon="microscope",
            accent="cyan",
            template_id="fixed.research",
            lifecycle="active" if index < 19 else "archived",
            document=_document(f"Desk {index}").model_dump(mode="json", by_alias=True),
            revision=1,
            link_set_revision=1,
            created_at=now,
            updated_at=now,
        )
        for index in range(49)
    ]
    async with session_factory() as db:
        db.add_all(seeded)
        await db.commit()

    service = _service(WorkbenchRepository())
    async with session_factory() as db:
        fiftieth = await service.create_definition(
            db,
            owner_id,
            WorkbenchDefinitionCreateRequest(document=_document("Desk 50")),
            uuid4(),
        )
        await db.commit()
    assert fiftieth.revision == 1

    async with session_factory() as db:
        await service.archive_definition(
            db,
            owner_id,
            fiftieth.id,
            WorkbenchDefinitionLifecycleRequest(
                expected_revision=1,
                base_lifecycle="active",
            ),
        )
        await db.commit()

    async with session_factory() as db:
        with pytest.raises(APIError) as total_limit:
            await service.create_definition(
                db,
                owner_id,
                WorkbenchDefinitionCreateRequest(document=_document("Desk 51")),
                uuid4(),
            )
        assert total_limit.value.code == "WORKBENCH_RATE_LIMITED"
        await db.rollback()

    archived = seeded[-1]
    async with session_factory() as db:
        restored = await service.restore_definition(
            db,
            owner_id,
            archived.id,
            WorkbenchDefinitionLifecycleRequest(
                expected_revision=1,
                base_lifecycle="archived",
            ),
        )
        await db.commit()
    assert restored.lifecycle == "active"

    async with session_factory() as db:
        with pytest.raises(APIError) as active_limit:
            await service.restore_definition(
                db,
                owner_id,
                seeded[-2].id,
                WorkbenchDefinitionLifecycleRequest(
                    expected_revision=1,
                    base_lifecycle="archived",
                ),
            )
        assert active_limit.value.code == "WORKBENCH_RATE_LIMITED"
        await db.rollback()

    async with session_factory() as db:
        with pytest.raises(APIError) as hidden:
            await service.get_definition(db, other_owner_id, fiftieth.id)
        assert hidden.value.code == "RESOURCE_NOT_FOUND"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_serializes_concurrent_creates_at_definition_limits() -> None:
    owner_id = await _create_user("concurrent-create-quota")
    now = datetime.now(UTC)
    seeded = [
        WorkbenchDefinition(
            id=uuid4(),
            owner_user_id=owner_id,
            name=f"Desk {index}",
            description="",
            icon="microscope",
            accent="cyan",
            template_id="fixed.research",
            lifecycle="active" if index < 19 else "archived",
            document=_document(f"Desk {index}").model_dump(mode="json", by_alias=True),
            revision=1,
            link_set_revision=1,
            created_at=now,
            updated_at=now,
        )
        for index in range(49)
    ]
    async with session_factory() as db:
        db.add_all(seeded)
        await db.commit()

    async def create(name: str) -> UUID | str:
        async with session_factory() as db:
            try:
                response = await _service(WorkbenchRepository()).create_definition(
                    db,
                    owner_id,
                    WorkbenchDefinitionCreateRequest(document=_document(name)),
                    uuid4(),
                )
                await db.commit()
                return response.id
            except APIError as error:
                await db.rollback()
                return error.code

    outcomes = await asyncio.gather(create("Concurrent A"), create("Concurrent B"))
    assert sum(isinstance(outcome, UUID) for outcome in outcomes) == 1
    assert outcomes.count("WORKBENCH_RATE_LIMITED") == 1

    async with session_factory() as db:
        assert (
            await db.scalar(
                select(func.count(WorkbenchDefinition.id)).where(
                    WorkbenchDefinition.owner_user_id == owner_id
                )
            )
            == 50
        )
        assert (
            await db.scalar(
                select(func.count(WorkbenchDefinition.id)).where(
                    WorkbenchDefinition.owner_user_id == owner_id,
                    WorkbenchDefinition.lifecycle == "active",
                )
            )
            == 20
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_serializes_concurrent_restores_at_active_limit() -> None:
    owner_id = await _create_user("concurrent-restore-quota")
    now = datetime.now(UTC)
    seeded = [
        WorkbenchDefinition(
            id=uuid4(),
            owner_user_id=owner_id,
            name=f"Desk {index}",
            description="",
            icon="microscope",
            accent="cyan",
            template_id="fixed.research",
            lifecycle="active" if index < 19 else "archived",
            document=_document(f"Desk {index}").model_dump(mode="json", by_alias=True),
            revision=1,
            link_set_revision=1,
            created_at=now,
            updated_at=now,
        )
        for index in range(21)
    ]
    async with session_factory() as db:
        db.add_all(seeded)
        await db.commit()

    async def restore(definition: WorkbenchDefinition) -> UUID | str:
        async with session_factory() as db:
            try:
                response = await _service(WorkbenchRepository()).restore_definition(
                    db,
                    owner_id,
                    definition.id,
                    WorkbenchDefinitionLifecycleRequest(
                        expected_revision=1,
                        base_lifecycle="archived",
                    ),
                )
                await db.commit()
                return response.id
            except APIError as error:
                await db.rollback()
                return error.code

    outcomes = await asyncio.gather(restore(seeded[-2]), restore(seeded[-1]))
    assert sum(isinstance(outcome, UUID) for outcome in outcomes) == 1
    assert outcomes.count("WORKBENCH_RATE_LIMITED") == 1

    async with session_factory() as db:
        assert (
            await db.scalar(
                select(func.count(WorkbenchDefinition.id)).where(
                    WorkbenchDefinition.owner_user_id == owner_id,
                    WorkbenchDefinition.lifecycle == "active",
                )
            )
            == 20
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_definition_keyset_is_stable_and_owner_scoped() -> None:
    owner_id = await _create_user("page")
    other_owner_id = await _create_user("page-other")
    now = datetime.now(UTC)
    rows = [
        _definition(owner_id),
        _definition(owner_id),
        _definition(owner_id),
        _definition(other_owner_id),
    ]
    for index, row in enumerate(rows):
        row.updated_at = now - timedelta(minutes=index)
        row.created_at = row.updated_at
    async with session_factory() as db:
        db.add_all(rows)
        await db.commit()

    service = _service(WorkbenchRepository())
    async with session_factory() as db:
        first = await service.list_definitions(db, owner_id, lifecycle=None, limit=2)
        assert [item.id for item in first.items] == [rows[0].id, rows[1].id]
        assert first.next_cursor is not None
        second = await service.list_definitions(
            db,
            owner_id,
            lifecycle=None,
            limit=2,
            cursor=first.next_cursor,
        )
        assert [item.id for item in second.items] == [rows[2].id]
        assert second.next_cursor is None
