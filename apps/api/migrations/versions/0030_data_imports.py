"""Add encrypted preview-first data imports.

Revision ID: 0030_data_imports
Revises: 0029_data_exports
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0030_data_imports"
down_revision: str | None = "0029_data_exports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_import_previews",
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
        sa.Column("source_format", sa.String(16), nullable=False),
        sa.Column("source_filename", sa.String(255), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("normalized_ciphertext", sa.LargeBinary()),
        sa.Column("normalized_nonce", sa.LargeBinary()),
        sa.Column("normalized_encryption_key_id", sa.String(64)),
        sa.Column("counts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="previewed"),
        sa.Column("imported_space_id", sa.Uuid()),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("imported_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('previewed','imported','expired')",
            name="ck_data_import_preview_status",
        ),
        sa.CheckConstraint(
            "source_format IN ('logion_json','markdown','csv','bibtex')",
            name="ck_data_import_preview_format",
        ),
    )
    op.create_index(
        "ix_data_import_preview_owner",
        "data_import_previews",
        ["workspace_id", "requested_by", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_data_import_preview_owner", table_name="data_import_previews")
    op.drop_table("data_import_previews")
