from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import pytest
from logion_api.sync.models import (
    ProcessedSyncOperation,
    SyncChange,
    WorkspaceSyncState,
)
from logion_api.sync.service import (
    AppliedSyncChange,
    SyncLedgerError,
    SyncLedgerService,
    SyncOperationIdentity,
)
from sqlalchemy.ext.asyncio import AsyncSession

HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


class ReplaySession:
    def __init__(
        self,
        processed: ProcessedSyncOperation | None,
        change: SyncChange | None,
    ) -> None:
        self.processed = processed
        self.change = change

    async def get(self, _model: object, _key: object) -> ProcessedSyncOperation | None:
        return self.processed

    async def scalar(self, _query: object) -> SyncChange | None:
        return self.change


def identity() -> SyncOperationIdentity:
    return SyncOperationIdentity(
        operation_id=uuid4(),
        workspace_id=uuid4(),
        device_id=uuid4(),
        payload_hash=HASH_A,
        operation_fingerprint=HASH_A,
        entity_type="note",
        entity_id=uuid4(),
        operation_type="create",
    )


@pytest.mark.asyncio
async def test_replay_returns_only_the_durable_minimal_result() -> None:
    operation = identity()
    processed = ProcessedSyncOperation(
        operation_id=operation.operation_id,
        workspace_id=operation.workspace_id,
        device_id=operation.device_id,
        payload_hash=operation.payload_hash,
        operation_fingerprint=operation.operation_fingerprint,
        entity_type=operation.entity_type,
        entity_id=operation.entity_id,
        operation_type=operation.operation_type,
    )
    change = SyncChange(
        workspace_id=operation.workspace_id,
        sequence=7,
        sync_epoch=uuid4(),
        operation_id=operation.operation_id,
        entity_type=operation.entity_type,
        entity_id=operation.entity_id,
        operation_type=operation.operation_type,
        server_version=3,
        occurred_at=datetime.now(UTC),
        tombstone=False,
        deleted_at=None,
        payload={"private": "not returned"},
        payload_hash=HASH_B,
    )
    db = cast(AsyncSession, ReplaySession(processed, change))

    result = await SyncLedgerService().find_replay(db, operation)

    assert result is not None
    assert result.duplicate
    assert result.sequence == 7
    assert result.server_version == 3
    assert "private" not in repr(result)


@pytest.mark.asyncio
async def test_replay_rejects_changed_hash_and_context() -> None:
    operation = identity()
    processed = ProcessedSyncOperation(
        operation_id=operation.operation_id,
        workspace_id=operation.workspace_id,
        device_id=operation.device_id,
        payload_hash=operation.payload_hash,
        operation_fingerprint=operation.operation_fingerprint,
        entity_type=operation.entity_type,
        entity_id=operation.entity_id,
        operation_type=operation.operation_type,
    )
    db = cast(AsyncSession, ReplaySession(processed, None))
    service = SyncLedgerService()

    with pytest.raises(SyncLedgerError) as hash_error:
        await service.find_replay(
            db,
            SyncOperationIdentity(**{**operation.__dict__, "payload_hash": HASH_B}),
        )
    assert hash_error.value.code == "SYNC_OPERATION_HASH_MISMATCH"

    with pytest.raises(SyncLedgerError) as fingerprint_error:
        await service.find_replay(
            db,
            SyncOperationIdentity(**{**operation.__dict__, "operation_fingerprint": HASH_B}),
        )
    assert fingerprint_error.value.code == "SYNC_CONTEXT_MISMATCH"

    with pytest.raises(SyncLedgerError) as context_error:
        await service.find_replay(
            db,
            SyncOperationIdentity(**{**operation.__dict__, "workspace_id": uuid4()}),
        )
    assert context_error.value.code == "SYNC_CONTEXT_MISMATCH"


@pytest.mark.asyncio
async def test_append_rejects_cross_workspace_and_invalid_tombstone_before_writes() -> None:
    operation = identity()
    service = SyncLedgerService()
    no_db = cast(AsyncSession, object())

    with pytest.raises(SyncLedgerError) as workspace_error:
        await service.append_applied(
            no_db,
            WorkspaceSyncState(workspace_id=uuid4()),
            operation,
            AppliedSyncChange(
                server_version=1,
                payload={},
                payload_hash=HASH_A,
            ),
        )
    assert workspace_error.value.code == "SYNC_CONTEXT_MISMATCH"

    delete = SyncOperationIdentity(**{**operation.__dict__, "operation_type": "delete"})
    with pytest.raises(SyncLedgerError) as tombstone_error:
        await service.append_applied(
            no_db,
            WorkspaceSyncState(workspace_id=operation.workspace_id),
            delete,
            AppliedSyncChange(
                server_version=2,
                payload={"leaked": "body"},
                payload_hash=HASH_A,
                tombstone=True,
                deleted_at=datetime.now(UTC),
            ),
        )
    assert tombstone_error.value.code == "SYNC_CONTEXT_MISMATCH"
