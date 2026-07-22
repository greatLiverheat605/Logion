"""Add encrypted asynchronous data export jobs.

Revision ID: 0029_data_exports
Revises: 0028_engagement
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_data_exports"
down_revision: str | None = "0028_engagement"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_export_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column(
            "schema_version", sa.String(32), nullable=False, server_default="logion-export-v1"
        ),
        sa.Column("artifact_ciphertext", sa.LargeBinary()),
        sa.Column("artifact_nonce", sa.LargeBinary()),
        sa.Column("artifact_encryption_key_id", sa.String(64)),
        sa.Column("artifact_sha256", sa.String(64)),
        sa.Column("artifact_bytes", sa.BigInteger()),
        sa.Column("error_code", sa.String(64)),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued','running','succeeded','failed','cancelled','expired')",
            name="ck_data_export_job_status",
        ),
    )
    op.create_index("ix_data_export_job_queue", "data_export_jobs", ["status", "created_at"])
    op.create_index(
        "ix_data_export_job_owner",
        "data_export_jobs",
        ["workspace_id", "requested_by", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_data_export_job_owner", table_name="data_export_jobs")
    op.drop_index("ix_data_export_job_queue", table_name="data_export_jobs")
    op.drop_table("data_export_jobs")
