from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import Device
from logion_api.main import app
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
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, IntegrityError

HASH_A = f"sha256:{'a' * 64}"
HASH_B = f"sha256:{'b' * 64}"


async def _register(label: str, client_ip: str) -> tuple[UUID, UUID, UUID]:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(client_ip, 54000)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"sync-ledger-{label}-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": f"Sync ledger {label}",
            },
        )
        assert registered.status_code == 201, registered.text
        user_id = UUID(registered.json()["user"]["id"])
        workspace_response = await client.get("/api/v1/workspaces")
        assert workspace_response.status_code == 200
        workspace_id = UUID(workspace_response.json()["workspaces"][0]["id"])
    async with session_factory() as db:
        device_id = await db.scalar(
            select(Device.id)
            .where(Device.user_id == user_id)
            .order_by(Device.first_seen_at.desc())
        )
    assert device_id is not None
    return user_id, workspace_id, device_id


def _identity(
    workspace_id: UUID,
    device_id: UUID,
    *,
    operation_id: UUID | None = None,
    payload_hash: str = HASH_A,
    entity_id: UUID | None = None,
) -> SyncOperationIdentity:
    return SyncOperationIdentity(
        operation_id=operation_id or uuid4(),
        workspace_id=workspace_id,
        device_id=device_id,
        payload_hash=payload_hash,
        operation_fingerprint=HASH_A,
        entity_type="note",
        entity_id=entity_id or uuid4(),
        operation_type="create",
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sync_ledger_is_idempotent_monotonic_tenant_scoped_and_atomic() -> None:
    _, workspace_a, device_a = await _register("a", "192.0.2.140")
    _, workspace_b, device_b = await _register("b", "192.0.2.141")
    service = SyncLedgerService()
    operation_a = _identity(workspace_a, device_a)
    operation_b = _identity(workspace_a, device_a)
    operation_other_workspace = _identity(workspace_b, device_b)

    async with session_factory() as db:
        state_a = await service.lock_workspace_state(db, workspace_a)
        first = await service.append_applied(
            db,
            state_a,
            operation_a,
            AppliedSyncChange(
                server_version=1,
                payload={"markdown": "first"},
                payload_hash=HASH_A,
            ),
        )
        second = await service.append_applied(
            db,
            state_a,
            operation_b,
            AppliedSyncChange(
                server_version=1,
                payload={"markdown": "second"},
                payload_hash=HASH_B,
            ),
        )
        state_b = await service.lock_workspace_state(db, workspace_b)
        other = await service.append_applied(
            db,
            state_b,
            operation_other_workspace,
            AppliedSyncChange(
                server_version=1,
                payload={"markdown": "other workspace"},
                payload_hash=HASH_A,
            ),
        )
        await db.commit()

    assert (first.sequence, second.sequence, other.sequence) == (1, 2, 1)
    assert first.sync_epoch == second.sync_epoch
    assert first.sync_epoch != other.sync_epoch
    assert not first.duplicate

    async with session_factory() as db:
        await service.lock_workspace_state(db, workspace_a)
        replay = await service.find_replay(db, operation_a)
        assert replay is not None
        assert replay.duplicate
        assert replay.sequence == first.sequence
        assert replay.server_version == first.server_version

        with pytest.raises(SyncLedgerError) as changed_hash:
            await service.find_replay(
                db,
                _identity(
                    workspace_a,
                    device_a,
                    operation_id=operation_a.operation_id,
                    payload_hash=HASH_B,
                    entity_id=operation_a.entity_id,
                ),
            )
        assert changed_hash.value.code == "SYNC_OPERATION_HASH_MISMATCH"

        with pytest.raises(SyncLedgerError) as changed_workspace:
            await service.find_replay(
                db,
                _identity(
                    workspace_b,
                    device_b,
                    operation_id=operation_a.operation_id,
                    entity_id=operation_a.entity_id,
                ),
            )
        assert changed_workspace.value.code == "SYNC_CONTEXT_MISMATCH"
        await db.rollback()

    rolled_back = _identity(workspace_a, device_a)
    async with session_factory() as db:
        state = await service.lock_workspace_state(db, workspace_a)
        result = await service.append_applied(
            db,
            state,
            rolled_back,
            AppliedSyncChange(
                server_version=1,
                payload={"markdown": "must roll back"},
                payload_hash=HASH_A,
            ),
        )
        assert result.sequence == 3
        await db.rollback()

    async with session_factory() as db:
        state = await db.get(WorkspaceSyncState, workspace_a)
        assert state is not None
        assert state.last_sequence == 2
        assert await db.get(ProcessedSyncOperation, rolled_back.operation_id) is None
        assert (
            await db.scalar(
                select(func.count(SyncChange.operation_id)).where(
                    SyncChange.operation_id == rolled_back.operation_id
                )
            )
            == 0
        )

        processed = await db.get(ProcessedSyncOperation, operation_a.operation_id)
        assert processed is not None
        with pytest.raises(DBAPIError):
            async with db.begin_nested():
                processed.payload_hash = HASH_B
                await db.flush()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sync_ledger_database_constraints_reject_cross_tenant_and_bad_tombstones() -> None:
    _, workspace_a, device_a = await _register("constraints-a", "192.0.2.142")
    _, workspace_b, _ = await _register("constraints-b", "192.0.2.143")
    service = SyncLedgerService()

    async with session_factory() as db:
        state_a = await service.lock_workspace_state(db, workspace_a)
        state_b = await service.lock_workspace_state(db, workspace_b)
        orphan = _identity(workspace_a, device_a)
        db.add(
            ProcessedSyncOperation(
                operation_id=orphan.operation_id,
                workspace_id=orphan.workspace_id,
                device_id=orphan.device_id,
                payload_hash=orphan.payload_hash,
                operation_fingerprint=orphan.operation_fingerprint,
                entity_type=orphan.entity_type,
                entity_id=orphan.entity_id,
                operation_type=orphan.operation_type,
            )
        )
        await db.flush()
        state_b.last_sequence = 1
        await db.flush()

        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(
                    SyncChange(
                        workspace_id=workspace_b,
                        sequence=1,
                        sync_epoch=state_b.sync_epoch,
                        operation_id=orphan.operation_id,
                        entity_type=orphan.entity_type,
                        entity_id=orphan.entity_id,
                        operation_type=orphan.operation_type,
                        server_version=1,
                        occurred_at=datetime.now(UTC),
                        tombstone=False,
                        deleted_at=None,
                        payload={"markdown": "cross tenant"},
                        payload_hash=HASH_A,
                    )
                )
                await db.flush()

        tombstone_operation = SyncOperationIdentity(
            operation_id=uuid4(),
            workspace_id=workspace_a,
            device_id=device_a,
            payload_hash=HASH_A,
            operation_fingerprint=HASH_A,
            entity_type="note",
            entity_id=uuid4(),
            operation_type="delete",
        )
        db.add(
            ProcessedSyncOperation(
                operation_id=tombstone_operation.operation_id,
                workspace_id=workspace_a,
                device_id=device_a,
                payload_hash=HASH_A,
                operation_fingerprint=HASH_A,
                entity_type="note",
                entity_id=tombstone_operation.entity_id,
                operation_type="delete",
            )
        )
        await db.flush()
        state_a.last_sequence = 1
        await db.flush()
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(
                    SyncChange(
                        workspace_id=workspace_a,
                        sequence=1,
                        sync_epoch=state_a.sync_epoch,
                        operation_id=tombstone_operation.operation_id,
                        entity_type="note",
                        entity_id=tombstone_operation.entity_id,
                        operation_type="delete",
                        server_version=2,
                        occurred_at=datetime.now(UTC),
                        tombstone=True,
                        deleted_at=datetime.now(UTC),
                        payload={"leaked": "deleted body"},
                        payload_hash=HASH_A,
                    )
                )
                await db.flush()

        head_violation = _identity(workspace_a, device_a)
        db.add(
            ProcessedSyncOperation(
                operation_id=head_violation.operation_id,
                workspace_id=workspace_a,
                device_id=device_a,
                payload_hash=HASH_A,
                operation_fingerprint=HASH_A,
                entity_type="note",
                entity_id=head_violation.entity_id,
                operation_type="create",
            )
        )
        await db.flush()
        with pytest.raises(IntegrityError):
            async with db.begin_nested():
                db.add(
                    SyncChange(
                        workspace_id=workspace_a,
                        sequence=99,
                        sync_epoch=state_a.sync_epoch,
                        operation_id=head_violation.operation_id,
                        entity_type="note",
                        entity_id=head_violation.entity_id,
                        operation_type="create",
                        server_version=1,
                        occurred_at=datetime.now(UTC),
                        tombstone=False,
                        deleted_at=None,
                        payload={"markdown": "gap"},
                        payload_hash=HASH_A,
                    )
                )
                await db.flush()

        with pytest.raises(SyncLedgerError) as invalid_delete:
            await service.append_applied(
                db,
                state_a,
                tombstone_operation,
                AppliedSyncChange(
                    server_version=2,
                    payload={"leaked": "deleted body"},
                    payload_hash=HASH_A,
                    tombstone=True,
                    deleted_at=datetime.now(UTC),
                ),
            )
        assert invalid_delete.value.code == "SYNC_CONTEXT_MISMATCH"
        await db.rollback()
