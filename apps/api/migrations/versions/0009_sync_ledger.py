"""Add workspace sync epoch, processed operations and change ledger.

Revision ID: 0009_sync_ledger
Revises: 0008_email_verification
Create Date: 2026-07-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_sync_ledger"
down_revision: str | None = "0008_email_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_sync_states",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("sync_epoch", sa.Uuid(), nullable=False),
        sa.Column("last_sequence", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column(
            "min_retained_sequence",
            sa.BigInteger(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "snapshot_schema_version",
            sa.SmallInteger(),
            server_default="1",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "last_sequence >= 0",
            name="ck_workspace_sync_last_sequence",
        ),
        sa.CheckConstraint(
            "min_retained_sequence >= 0 AND min_retained_sequence <= last_sequence",
            name="ck_workspace_sync_retention_floor",
        ),
        sa.CheckConstraint(
            "snapshot_schema_version = 1",
            name="ck_workspace_sync_snapshot_schema",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("workspace_id"),
    )
    op.create_table(
        "processed_sync_operations",
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=False),
        sa.Column("payload_hash", sa.String(length=71), nullable=False),
        sa.Column("operation_fingerprint", sa.String(length=71), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("operation_type", sa.String(length=16), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_processed_sync_payload_hash",
        ),
        sa.CheckConstraint(
            "operation_fingerprint ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_processed_sync_fingerprint",
        ),
        sa.CheckConstraint(
            "entity_type ~ '^[a-z][a-z0-9_]{1,63}$'",
            name="ck_processed_sync_entity_type",
        ),
        sa.CheckConstraint(
            "operation_type IN ('create', 'update', 'delete', 'restore')",
            name="ck_processed_sync_operation_type",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace_sync_states.workspace_id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("operation_id"),
        sa.UniqueConstraint(
            "operation_id",
            "workspace_id",
            "entity_type",
            "entity_id",
            "operation_type",
            name="uq_processed_sync_identity",
        ),
    )
    op.create_index(
        "ix_processed_sync_workspace_device",
        "processed_sync_operations",
        ["workspace_id", "device_id", "processed_at"],
    )
    op.create_table(
        "sync_changes",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.BigInteger(), nullable=False),
        sa.Column("sync_epoch", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("operation_type", sa.String(length=16), nullable=False),
        sa.Column("server_version", sa.BigInteger(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("tombstone", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload_hash", sa.String(length=71), nullable=False),
        sa.CheckConstraint("sequence >= 1", name="ck_sync_changes_sequence"),
        sa.CheckConstraint("server_version >= 1", name="ck_sync_changes_server_version"),
        sa.CheckConstraint(
            "payload_hash ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_sync_changes_payload_hash",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object'",
            name="ck_sync_changes_payload_object",
        ),
        sa.CheckConstraint(
            "((operation_type = 'delete' AND tombstone AND deleted_at IS NOT NULL "
            "AND payload = '{}'::jsonb) OR "
            "(operation_type <> 'delete' AND NOT tombstone AND deleted_at IS NULL))",
            name="ck_sync_changes_tombstone",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace_sync_states.workspace_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
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
        sa.PrimaryKeyConstraint("workspace_id", "sequence"),
        sa.UniqueConstraint("operation_id", name="uq_sync_changes_operation"),
    )
    op.create_index(
        "ix_sync_changes_workspace_epoch_sequence",
        "sync_changes",
        ["workspace_id", "sync_epoch", "sequence"],
    )
    op.create_index(
        "ix_sync_changes_workspace_entity",
        "sync_changes",
        ["workspace_id", "entity_type", "entity_id", "sequence"],
    )
    op.execute(
        """
        CREATE FUNCTION enforce_sync_change_head() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            expected_sequence bigint;
            expected_epoch uuid;
        BEGIN
            SELECT last_sequence, sync_epoch
              INTO expected_sequence, expected_epoch
              FROM workspace_sync_states
             WHERE workspace_id = NEW.workspace_id;
            IF NOT FOUND
               OR NEW.sequence <> expected_sequence
               OR NEW.sync_epoch <> expected_epoch THEN
                RAISE EXCEPTION 'sync change is not the locked workspace head'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_sync_changes_enforce_head
        BEFORE INSERT ON sync_changes
        FOR EACH ROW EXECUTE FUNCTION enforce_sync_change_head()
        """
    )
    op.execute(
        """
        CREATE FUNCTION prevent_sync_ledger_update() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'sync ledger rows are immutable'
                USING ERRCODE = '55000';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_processed_sync_operations_immutable
        BEFORE UPDATE ON processed_sync_operations
        FOR EACH ROW EXECUTE FUNCTION prevent_sync_ledger_update()
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_sync_changes_immutable
        BEFORE UPDATE ON sync_changes
        FOR EACH ROW EXECUTE FUNCTION prevent_sync_ledger_update()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER trg_sync_changes_immutable ON sync_changes")
    op.execute("DROP TRIGGER trg_processed_sync_operations_immutable ON processed_sync_operations")
    op.execute("DROP FUNCTION prevent_sync_ledger_update()")
    op.execute("DROP TRIGGER trg_sync_changes_enforce_head ON sync_changes")
    op.execute("DROP FUNCTION enforce_sync_change_head()")
    op.drop_index("ix_sync_changes_workspace_entity", table_name="sync_changes")
    op.drop_index("ix_sync_changes_workspace_epoch_sequence", table_name="sync_changes")
    op.drop_table("sync_changes")
    op.drop_index(
        "ix_processed_sync_workspace_device",
        table_name="processed_sync_operations",
    )
    op.drop_table("processed_sync_operations")
    op.drop_table("workspace_sync_states")
