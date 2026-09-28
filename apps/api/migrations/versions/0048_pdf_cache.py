"""pdf_cache

Revision ID: 0048_pdf_cache
Revises: 0047_zotero_sync
Create Date: 2026-09-28 13:42:59.377035
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048_pdf_cache"
down_revision: str | None = "0047_zotero_sync"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pdf_cache_entries",
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("storage_key", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("encrypted_bytes", sa.BigInteger(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(length=12), nullable=False),
        sa.Column("wrapped_key", sa.LargeBinary(), nullable=False),
        sa.Column("key_nonce", sa.LargeBinary(length=12), nullable=False),
        sa.Column("key_id", sa.String(length=64), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("sha256 ~ '^[a-f0-9]{64}$'", name="ck_pdf_cache_sha"),
        sa.CheckConstraint(
            "size_bytes > 0 AND encrypted_bytes = size_bytes + 16", name="ck_pdf_cache_size"
        ),
        sa.PrimaryKeyConstraint("sha256"),
    )
    op.create_table(
        "webdav_monthly_usage",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("downloaded_bytes", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("downloaded_bytes >= 0", name="ck_webdav_usage_bytes"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "month"),
    )
    op.create_table(
        "pdf_cache_bindings",
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("credential_id", sa.Uuid(), nullable=False),
        sa.Column("credential_revision", sa.LargeBinary(length=12), nullable=False),
        sa.Column("locator_digest", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["integration_credentials.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["resource_id"], ["resources.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sha256"], ["pdf_cache_entries.sha256"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("resource_id"),
    )
    op.add_column(
        "resources", sa.Column("zotero_attachment_version", sa.BigInteger(), nullable=True)
    )


def downgrade() -> None:
    connection = op.get_bind()
    for table in ("pdf_cache_bindings", "pdf_cache_entries", "webdav_monthly_usage"):
        if connection.scalar(sa.select(sa.exists().select_from(sa.table(table)))):
            raise RuntimeError("Preserve PDF/cache/usage data before downgrade.")
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM resources WHERE zotero_attachment_version IS NOT NULL)"
        )
    ):
        raise RuntimeError("Preserve Zotero attachment versions before downgrade.")
    op.drop_column("resources", "zotero_attachment_version")
    op.drop_table("pdf_cache_bindings")
    op.drop_table("webdav_monthly_usage")
    op.drop_table("pdf_cache_entries")
