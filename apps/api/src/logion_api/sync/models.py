from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class WorkspaceSyncState(Base):
    __tablename__ = "workspace_sync_states"
    __table_args__ = (
        CheckConstraint("last_sequence >= 0", name="ck_workspace_sync_last_sequence"),
        CheckConstraint(
            "min_retained_sequence >= 0 AND min_retained_sequence <= last_sequence",
            name="ck_workspace_sync_retention_floor",
        ),
        CheckConstraint(
            "snapshot_schema_version = 1",
            name="ck_workspace_sync_snapshot_schema",
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    )
    sync_epoch: Mapped[UUID] = mapped_column(Uuid, nullable=False, default=uuid7)
    last_sequence: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    min_retained_sequence: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        default=0,
    )
    snapshot_schema_version: Mapped[int] = mapped_column(
        SmallInteger,
        nullable=False,
        default=1,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ProcessedSyncOperation(Base):
    __tablename__ = "processed_sync_operations"
    __table_args__ = (
        CheckConstraint(
            "payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_processed_sync_payload_hash",
        ),
        CheckConstraint(
            "operation_fingerprint ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_processed_sync_fingerprint",
        ),
        CheckConstraint(
            "entity_type ~ '^[a-z][a-z0-9_]{1,63}$'",
            name="ck_processed_sync_entity_type",
        ),
        CheckConstraint(
            "operation_type IN ('create', 'update', 'delete', 'restore')",
            name="ck_processed_sync_operation_type",
        ),
        UniqueConstraint(
            "operation_id",
            "workspace_id",
            "entity_type",
            "entity_id",
            "operation_type",
            name="uq_processed_sync_identity",
        ),
        Index(
            "ix_processed_sync_workspace_device",
            "workspace_id",
            "device_id",
            "processed_at",
        ),
    )

    operation_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspace_sync_states.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    device_id: Mapped[UUID] = mapped_column(
        Uuid,
        nullable=False,
    )
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    operation_fingerprint: Mapped[str] = mapped_column(String(71), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    operation_type: Mapped[str] = mapped_column(String(16), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SyncChange(Base):
    __tablename__ = "sync_changes"
    __table_args__ = (
        ForeignKeyConstraint(
            [
                "operation_id",
                "workspace_id",
                "entity_type",
                "entity_id",
                "operation_type",
            ],
            [
                "processed_sync_operations.operation_id",
                "processed_sync_operations.workspace_id",
                "processed_sync_operations.entity_type",
                "processed_sync_operations.entity_id",
                "processed_sync_operations.operation_type",
            ],
            name="fk_sync_changes_processed_identity",
            ondelete="CASCADE",
        ),
        CheckConstraint("sequence >= 1", name="ck_sync_changes_sequence"),
        CheckConstraint("server_version >= 1", name="ck_sync_changes_server_version"),
        CheckConstraint(
            "payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_changes_payload_hash",
        ),
        CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name="ck_sync_changes_payload_object",
        ),
        CheckConstraint(
            "((operation_type = 'delete' AND tombstone AND deleted_at IS NOT NULL "
            "AND payload = '{}'::jsonb) OR "
            "(operation_type <> 'delete' AND NOT tombstone AND deleted_at IS NULL))",
            name="ck_sync_changes_tombstone",
        ),
        UniqueConstraint("operation_id", name="uq_sync_changes_operation"),
        Index(
            "ix_sync_changes_workspace_epoch_sequence",
            "workspace_id",
            "sync_epoch",
            "sequence",
        ),
        Index(
            "ix_sync_changes_workspace_entity",
            "workspace_id",
            "entity_type",
            "entity_id",
            "sequence",
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspace_sync_states.workspace_id", ondelete="CASCADE"),
        primary_key=True,
    )
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sync_epoch: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    operation_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    operation_type: Mapped[str] = mapped_column(String(16), nullable=False)
    server_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    tombstone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)


class SyncConflictRecord(Base):
    __tablename__ = "sync_conflict_records"
    __table_args__ = (
        CheckConstraint(
            "entity_type ~ '^[a-z][a-z0-9_]{1,63}$'",
            name="ck_sync_conflict_entity_type",
        ),
        CheckConstraint(
            "conflict_kind IN ('content', 'status', 'hierarchy', 'delete_update', 'permission')",
            name="ck_sync_conflict_kind",
        ),
        CheckConstraint(
            "status IN ('open', 'resolved_local', 'resolved_remote', 'resolved_merge', "
            "'dismissed')",
            name="ck_sync_conflict_status",
        ),
        CheckConstraint("base_version >= 0", name="ck_sync_conflict_base_version"),
        CheckConstraint("remote_version >= 1", name="ck_sync_conflict_remote_version"),
        CheckConstraint(
            "local_payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_conflict_local_hash",
        ),
        CheckConstraint(
            "remote_payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_conflict_remote_hash",
        ),
        CheckConstraint(
            "jsonb_typeof(resolution_options) = 'array' "
            "AND jsonb_array_length(resolution_options) > 0",
            name="ck_sync_conflict_options",
        ),
        UniqueConstraint(
            "workspace_id",
            "original_operation_id",
            "remote_version",
            "remote_payload_hash",
            name="uq_sync_conflict_remote_snapshot",
        ),
        Index("ix_sync_conflict_workspace_status_created", "workspace_id", "status", "created_at"),
    )

    conflict_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspace_sync_states.workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    original_operation_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    source_device_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    conflict_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    base_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    local_payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    remote_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    remote_payload_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    resolution_options: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    resolution_operation_id: Mapped[UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
