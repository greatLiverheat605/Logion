"""source_texts

Revision ID: 0049_source_texts
Revises: 0048_pdf_cache
Create Date: 2026-09-28 14:20:07.535711
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0049_source_texts"
down_revision: str | None = "0048_pdf_cache"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "source_texts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("file_sha256", sa.String(length=64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("page_offsets", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("extracted_by", sa.String(length=80), nullable=False),
        sa.Column("normalization_version", sa.String(length=32), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("file_sha256 ~ '^[a-f0-9]{64}$'", name="ck_source_text_file_sha"),
        sa.CheckConstraint("jsonb_typeof(page_offsets) = 'array'", name="ck_source_text_pages"),
        sa.CheckConstraint(
            "normalization_version = 'utf8-nfc-lf-v1'", name="ck_source_text_normalization"
        ),
        sa.CheckConstraint("octet_length(text) <= 5242880", name="ck_source_text_size"),
        sa.ForeignKeyConstraint(
            ["resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            name="fk_source_text_resource_scope",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("resource_id", "file_sha256", name="uq_source_text_file"),
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.select(sa.exists().select_from(sa.table("source_texts")))):
        raise RuntimeError("Preserve extracted source text before downgrade.")
    op.drop_table("source_texts")
