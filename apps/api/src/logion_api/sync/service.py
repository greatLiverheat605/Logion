from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.db import utc_now
from logion_api.sync.models import (
    ProcessedSyncOperation,
    SyncChange,
    WorkspaceSyncState,
)
from logion_api.workspaces.models import Workspace

SyncLedgerErrorCode = Literal[
    "SYNC_CONTEXT_MISMATCH",
    "SYNC_OPERATION_HASH_MISMATCH",
    "SYNC_WORKSPACE_NOT_FOUND",
]


class SyncLedgerError(Exception):
    def __init__(self, code: SyncLedgerErrorCode) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class SyncOperationIdentity:
    operation_id: UUID
    workspace_id: UUID
    device_id: UUID
    payload_hash: str
    operation_fingerprint: str
    entity_type: str
    entity_id: UUID
    operation_type: Literal["create", "update", "delete", "restore"]


@dataclass(frozen=True)
class AppliedSyncChange:
    server_version: int
    payload: dict[str, Any]
    payload_hash: str
    tombstone: bool = False
    deleted_at: datetime | None = None
    occurred_at: datetime | None = None


@dataclass(frozen=True)
class DurableSyncResult:
    operation_id: UUID
    workspace_id: UUID
    sync_epoch: UUID
    sequence: int
    server_version: int
    duplicate: bool


class SyncLedgerService:
    async def lock_workspace_state(
        self,
        db: AsyncSession,
        workspace_id: UUID,
    ) -> WorkspaceSyncState:
        workspace = await db.scalar(
            select(Workspace.id)
            .where(
                Workspace.id == workspace_id,
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if workspace is None:
            raise SyncLedgerError("SYNC_WORKSPACE_NOT_FOUND")
        state = await db.scalar(
            select(WorkspaceSyncState)
            .where(WorkspaceSyncState.workspace_id == workspace_id)
            .with_for_update()
        )
        if state is None:
            state = WorkspaceSyncState(workspace_id=workspace_id)
            db.add(state)
            await db.flush()
        return state

    async def find_replay(
        self,
        db: AsyncSession,
        identity: SyncOperationIdentity,
    ) -> DurableSyncResult | None:
        processed = await db.get(ProcessedSyncOperation, identity.operation_id)
        if processed is None:
            return None
        if processed.workspace_id != identity.workspace_id:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        if processed.device_id != identity.device_id:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        if processed.payload_hash != identity.payload_hash:
            raise SyncLedgerError("SYNC_OPERATION_HASH_MISMATCH")
        if processed.operation_fingerprint != identity.operation_fingerprint:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        if (
            processed.entity_type != identity.entity_type
            or processed.entity_id != identity.entity_id
            or processed.operation_type != identity.operation_type
        ):
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        change = await db.scalar(
            select(SyncChange).where(SyncChange.operation_id == identity.operation_id)
        )
        if change is None:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        return DurableSyncResult(
            operation_id=processed.operation_id,
            workspace_id=processed.workspace_id,
            sync_epoch=change.sync_epoch,
            sequence=change.sequence,
            server_version=change.server_version,
            duplicate=True,
        )

    async def append_applied(
        self,
        db: AsyncSession,
        state: WorkspaceSyncState,
        identity: SyncOperationIdentity,
        change: AppliedSyncChange,
    ) -> DurableSyncResult:
        if state.workspace_id != identity.workspace_id:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        if change.server_version < 1:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        if identity.operation_type == "delete":
            if not change.tombstone or change.deleted_at is None or change.payload:
                raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        elif change.tombstone or change.deleted_at is not None:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")

        existing = await self.find_replay(db, identity)
        if existing is not None:
            return existing
        state.last_sequence += 1
        state.updated_at = utc_now()
        await db.flush()
        processed = ProcessedSyncOperation(
            operation_id=identity.operation_id,
            workspace_id=identity.workspace_id,
            device_id=identity.device_id,
            payload_hash=identity.payload_hash,
            operation_fingerprint=identity.operation_fingerprint,
            entity_type=identity.entity_type,
            entity_id=identity.entity_id,
            operation_type=identity.operation_type,
        )
        occurred_at = change.occurred_at or utc_now()
        record = SyncChange(
            workspace_id=identity.workspace_id,
            sequence=state.last_sequence,
            sync_epoch=state.sync_epoch,
            operation_id=identity.operation_id,
            entity_type=identity.entity_type,
            entity_id=identity.entity_id,
            operation_type=identity.operation_type,
            server_version=change.server_version,
            occurred_at=occurred_at,
            tombstone=change.tombstone,
            deleted_at=change.deleted_at,
            payload=change.payload,
            payload_hash=change.payload_hash,
        )
        db.add_all((processed, record))
        await db.flush()
        return DurableSyncResult(
            operation_id=identity.operation_id,
            workspace_id=identity.workspace_id,
            sync_epoch=state.sync_epoch,
            sequence=state.last_sequence,
            server_version=change.server_version,
            duplicate=False,
        )
