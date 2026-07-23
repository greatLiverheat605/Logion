"""Persist hash-only sync conflicts for verified resolution.

Revision ID: 0034_sync_conflicts
Revises: 0033_note_yjs_state
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_sync_conflicts"
down_revision: str | None = "0033_note_yjs_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sync_conflict_records",
        sa.Column("conflict_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("original_operation_id", sa.Uuid(), nullable=False),
        sa.Column("source_device_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("conflict_kind", sa.String(length=24), nullable=False),
        sa.Column("base_version", sa.BigInteger(), nullable=False),
        sa.Column("local_payload_hash", sa.String(length=71), nullable=False),
        sa.Column("remote_version", sa.BigInteger(), nullable=False),
        sa.Column("remote_payload_hash", sa.String(length=71), nullable=False),
        sa.Column("resolution_options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=24), server_default="open", nullable=False),
        sa.Column("resolution_operation_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("base_version >= 0", name="ck_sync_conflict_base_version"),
        sa.CheckConstraint(
            "conflict_kind IN ('content', 'status', 'hierarchy', 'delete_update', 'permission')",
            name="ck_sync_conflict_kind",
        ),
        sa.CheckConstraint(
            "entity_type ~ '^[a-z][a-z0-9_]{1,63}$'",
            name="ck_sync_conflict_entity_type",
        ),
        sa.CheckConstraint(
            "local_payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_conflict_local_hash",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(resolution_options) = 'array' "
            "AND jsonb_array_length(resolution_options) > 0",
            name="ck_sync_conflict_options",
        ),
        sa.CheckConstraint(
            "remote_payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_conflict_remote_hash",
        ),
        sa.CheckConstraint("remote_version >= 1", name="ck_sync_conflict_remote_version"),
        sa.CheckConstraint(
            "status IN ('open', 'resolved_local', 'resolved_remote', 'resolved_merge', "
            "'dismissed')",
            name="ck_sync_conflict_status",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace_sync_states.workspace_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("conflict_id"),
        sa.UniqueConstraint(
            "workspace_id",
            "original_operation_id",
            "remote_version",
            "remote_payload_hash",
            name="uq_sync_conflict_remote_snapshot",
        ),
    )
    op.create_index(
        "ix_sync_conflict_workspace_status_created",
        "sync_conflict_records",
        ["workspace_id", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_sync_conflict_workspace_status_created",
        table_name="sync_conflict_records",
    )
    op.drop_table("sync_conflict_records")
