from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from logion_api.db import session_factory
from logion_api.errors import APIError
from logion_api.identity.models import User
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
)
from logion_api.workbenches.repository import (
    DefinitionCounts,
    DefinitionPage,
    WorkbenchRepository,
)
from logion_api.workbenches.schemas import (
    WorkbenchDefinitionCreateRequest,
    WorkbenchDefinitionDocumentV1,
    WorkbenchDefinitionLifecycleRequest,
    WorkbenchDefinitionReplaceRequest,
)
from logion_api.workbenches.service import (
    CREATE_OPERATION,
    WorkbenchService,
    _conflict_paths,
    definition_response,
    request_fingerprint,
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
    repository.add_definition = Mock()  # type: ignore[method-assign]
    repository.add_receipt = Mock()  # type: ignore[method-assign]
    return repository


def _db() -> AsyncSession:
    return cast(AsyncSession, AsyncMock(spec=AsyncSession))


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
