from typing import Literal, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.sync.models import SyncChange, WorkspaceSyncState
from logion_api.sync.push import canonical_hash
from logion_api.sync.schemas import BootstrapResponse, Change, EntityRecord, PullResponse
from logion_api.workspaces.models import Space


class SyncReadService:
    async def pull(
        self,
        db: AsyncSession,
        state: WorkspaceSyncState,
        *,
        device_id: UUID,
        user_id: UUID,
        cursor: int,
        limit: int,
    ) -> PullResponse:
        rows = list(
            (
                await db.scalars(
                    select(SyncChange)
                    .where(
                        SyncChange.workspace_id == state.workspace_id,
                        SyncChange.sync_epoch == state.sync_epoch,
                        SyncChange.sequence > cursor,
                    )
                    .order_by(SyncChange.sequence)
                    .limit(limit + 1)
                )
            ).all()
        )
        has_more = len(rows) > limit
        page = rows[:limit]
        visible_spaces = await self._visible_space_ids(
            db,
            state.workspace_id,
            user_id,
            {row.entity_id for row in page if row.entity_type == "space"},
        )
        changes = [
            Change(
                sequence=row.sequence,
                operation_id=row.operation_id,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                operation_type=cast(
                    Literal["create", "update", "delete", "restore"],
                    row.operation_type,
                ),
                server_version=row.server_version,
                occurred_at=row.occurred_at,
                tombstone=row.tombstone,
                deleted_at=row.deleted_at,
                payload=row.payload,
                payload_hash=row.payload_hash,
            )
            for row in page
            if row.entity_type == "space" and row.entity_id in visible_spaces
        ]
        return PullResponse(
            workspace_id=state.workspace_id,
            device_id=device_id,
            sync_epoch=state.sync_epoch,
            from_cursor=cursor,
            next_cursor=page[-1].sequence if page else cursor,
            has_more=has_more,
            changes=changes,
        )

    async def bootstrap(
        self,
        db: AsyncSession,
        state: WorkspaceSyncState,
        *,
        device_id: UUID,
        user_id: UUID,
        requested_snapshot_id: UUID | None,
        chunk_index: int | None,
        chunk_size: int = 100,
    ) -> BootstrapResponse:
        records = await self._space_records(db, state.workspace_id, user_id)
        chunks = [
            records[index : index + chunk_size]
            for index in range(0, len(records), chunk_size)
        ]
        if not chunks:
            chunks = [[]]
        checksums = [
            canonical_hash([record.model_dump(mode="json") for record in chunk])
            for chunk in chunks
        ]
        manifest = {
            "chunks": [
                {"chunk_index": index, "chunk_checksum": checksum}
                for index, checksum in enumerate(checksums)
            ]
        }
        snapshot_checksum = canonical_hash(manifest)
        snapshot_id = uuid5(
            NAMESPACE_URL,
            f"logion:{state.workspace_id}:{state.sync_epoch}:{state.last_sequence}:{snapshot_checksum}",
        )
        if requested_snapshot_id is not None and requested_snapshot_id != snapshot_id:
            raise StaleSnapshotError
        selected = chunk_index or 0
        if selected >= len(chunks):
            raise InvalidChunkError
        return BootstrapResponse(
            workspace_id=state.workspace_id,
            device_id=device_id,
            sync_epoch=state.sync_epoch,
            snapshot_id=snapshot_id,
            chunk_index=selected,
            chunk_count=len(chunks),
            cursor=state.last_sequence,
            snapshot_checksum=snapshot_checksum,
            chunk_checksum=checksums[selected],
            records=chunks[selected],
            created_at=state.updated_at,
        )

    async def _space_records(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
    ) -> list[EntityRecord]:
        spaces = list(
            (
                await db.scalars(
                    select(Space)
                    .where(
                        Space.workspace_id == workspace_id,
                        Space.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                    .order_by(Space.id)
                )
            ).all()
        )
        return [
            EntityRecord(
                entity_type="space",
                entity_id=space.id,
                version=space.version,
                created_at=space.created_at,
                updated_at=space.updated_at,
                deleted_at=space.deleted_at,
                created_by=space.created_by,
                updated_by=space.updated_by,
                payload={"name": space.name, "visibility": space.visibility},
                payload_hash=canonical_hash({"name": space.name, "visibility": space.visibility}),
            )
            for space in spaces
        ]

    async def _visible_space_ids(
        self,
        db: AsyncSession,
        workspace_id: UUID,
        user_id: UUID,
        entity_ids: set[UUID],
    ) -> set[UUID]:
        if not entity_ids:
            return set()
        return set(
            (
                await db.scalars(
                    select(Space.id).where(
                        Space.workspace_id == workspace_id,
                        Space.id.in_(entity_ids),
                        Space.deleted_at.is_(None),
                        (Space.visibility == "shared") | (Space.owner_user_id == user_id),
                    )
                )
            ).all()
        )


class StaleSnapshotError(Exception):
    pass


class InvalidChunkError(Exception):
    pass
