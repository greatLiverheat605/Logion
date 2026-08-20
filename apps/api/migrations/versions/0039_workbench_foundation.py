"""Add the dormant custom Workbench persistence foundation.

Revision ID: 0039_workbench_foundation
Revises: 0038_local_worker_protocol
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_workbench_foundation"
down_revision: str | None = "0038_local_worker_protocol"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workbench_definitions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=280), nullable=False, server_default=""),
        sa.Column("icon", sa.String(length=24), nullable=False),
        sa.Column("accent", sa.String(length=12), nullable=False),
        sa.Column("template_id", sa.String(length=24), nullable=False),
        sa.Column(
            "lifecycle",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column(
            "document",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("link_set_revision", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "lifecycle IN ('active','archived')",
            name="ck_workbench_definition_lifecycle",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_workbench_definition_revision"),
        sa.CheckConstraint(
            "link_set_revision >= 1",
            name="ck_workbench_definition_link_set_revision",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(document) = 'object'",
            name="ck_workbench_definition_document_object",
        ),
        sa.CheckConstraint(
            "char_length(btrim(name)) BETWEEN 1 AND 80",
            name="ck_workbench_definition_name",
        ),
        sa.CheckConstraint(
            "char_length(description) <= 280",
            name="ck_workbench_definition_description",
        ),
        sa.CheckConstraint(
            "icon IN ('book-open','microscope','graduation-cap','users',"
            "'layout-dashboard','target','folder','note')",
            name="ck_workbench_definition_icon",
        ),
        sa.CheckConstraint(
            "accent IN ('neutral','blue','green','amber','red','violet','cyan')",
            name="ck_workbench_definition_accent",
        ),
        sa.CheckConstraint(
            "template_id IN ('fixed.learning','fixed.research','fixed.exam',"
            "'fixed.mentor','blank')",
            name="ck_workbench_definition_template",
        ),
        sa.UniqueConstraint("id", "owner_user_id", name="uq_workbench_definition_owner"),
    )
    op.create_index(
        "ix_workbench_definitions_owner_lifecycle_updated",
        "workbench_definitions",
        ["owner_user_id", "lifecycle", "updated_at", "id"],
    )

    op.create_table(
        "workbench_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workbench_id", sa.Uuid(), nullable=False),
        sa.Column(
            "owner_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("primary_context", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "attributes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("revision", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["workbench_id", "owner_user_id"],
            ["workbench_definitions.id", "workbench_definitions.owner_user_id"],
            name="fk_workbench_link_definition_owner",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "target_kind IN ('task','source','topic','note','evidence','claim','project')",
            name="ck_workbench_link_target_kind",
        ),
        sa.CheckConstraint("position BETWEEN 0 AND 499", name="ck_workbench_link_position"),
        sa.CheckConstraint("revision >= 1", name="ck_workbench_link_revision"),
        sa.CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="ck_workbench_link_attributes",
        ),
        sa.UniqueConstraint(
            "workbench_id",
            "target_kind",
            "target_id",
            name="uq_workbench_link_target",
        ),
    )
    op.create_index(
        "ix_workbench_links_workbench_position",
        "workbench_links",
        ["workbench_id", "position", "id"],
    )
    op.create_index(
        "ix_workbench_links_owner_workbench",
        "workbench_links",
        ["owner_user_id", "workbench_id"],
    )

    op.create_table(
        "workbench_idempotency_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=71), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("retryable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("definition_id", sa.Uuid()),
        sa.Column(
            "response_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "operation IN ('workbench.definition.create.v1','workbench.definition.delete.v1',"
            "'workbench.link.create.v1','workbench.import.v1')",
            name="ck_workbench_receipt_operation",
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_workbench_receipt_fingerprint",
        ),
        sa.CheckConstraint(
            "outcome IN ('succeeded','failed')",
            name="ck_workbench_receipt_outcome",
        ),
        sa.CheckConstraint("retryable = false", name="ck_workbench_receipt_terminal"),
        sa.CheckConstraint(
            "jsonb_typeof(response_snapshot) = 'object'",
            name="ck_workbench_receipt_snapshot_object",
        ),
        sa.UniqueConstraint(
            "owner_user_id",
            "idempotency_key",
            name="uq_workbench_receipt_owner_key",
        ),
    )
    op.create_index(
        "ix_workbench_receipts_owner_created",
        "workbench_idempotency_receipts",
        ["owner_user_id", "created_at", "id"],
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError(
            "Workbench downgrade is disabled because table emptiness cannot be proven"
        )

    connection = op.get_bind()
    table_checks = (
        (
            "workbench_idempotency_receipts",
            sa.text("SELECT EXISTS (SELECT 1 FROM workbench_idempotency_receipts)"),
        ),
        ("workbench_links", sa.text("SELECT EXISTS (SELECT 1 FROM workbench_links)")),
        (
            "workbench_definitions",
            sa.text("SELECT EXISTS (SELECT 1 FROM workbench_definitions)"),
        ),
    )
    for table_name, statement in table_checks:
        if connection.execute(statement).scalar():
            raise RuntimeError(f"Workbench downgrade stopped: {table_name} is not empty")

    op.drop_index(
        "ix_workbench_receipts_owner_created",
        table_name="workbench_idempotency_receipts",
    )
    op.drop_table("workbench_idempotency_receipts")
    op.drop_index("ix_workbench_links_owner_workbench", table_name="workbench_links")
    op.drop_index("ix_workbench_links_workbench_position", table_name="workbench_links")
    op.drop_table("workbench_links")
    op.drop_index(
        "ix_workbench_definitions_owner_lifecycle_updated",
        table_name="workbench_definitions",
    )
    op.drop_table("workbench_definitions")
