"""Add verified attachment upload records.

Revision ID: 0032_attachments
Revises: 0031_account_deletion
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_attachments"
down_revision: str | None = "0031_account_deletion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "space_id",
            sa.Uuid(),
            sa.ForeignKey("spaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("declared_mime", sa.String(80), nullable=False),
        sa.Column("detected_mime", sa.String(80)),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("expected_sha256", sa.String(64), nullable=False),
        sa.Column("verified_sha256", sa.String(64)),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending_upload"),
        sa.Column("staging_key", sa.String(64), nullable=False),
        sa.Column("storage_key", sa.String(160)),
        sa.Column("failure_code", sa.String(64)),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
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
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending_upload','uploading','verified','failed','deleted')",
            name="ck_attachments_status",
        ),
        sa.CheckConstraint(
            "target_type IN ('note','evidence_item','experiment_run')",
            name="ck_attachments_target_type",
        ),
        sa.CheckConstraint("size_bytes BETWEEN 1 AND 104857600", name="ck_attachments_size"),
        sa.CheckConstraint(
            "expected_sha256 ~ '^[0-9a-f]{64}$'", name="ck_attachments_expected_sha"
        ),
        sa.CheckConstraint(
            "verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_attachments_verified_sha",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_attachment_workspace"),
    )
    op.create_index(
        "ix_attachments_workspace_space_status",
        "attachments",
        ["workspace_id", "space_id", "status"],
    )
    op.create_index("ix_attachments_owner_status", "attachments", ["created_by", "status"])


def downgrade() -> None:
    op.drop_index("ix_attachments_owner_status", table_name="attachments")
    op.drop_index("ix_attachments_workspace_space_status", table_name="attachments")
    op.drop_table("attachments")
