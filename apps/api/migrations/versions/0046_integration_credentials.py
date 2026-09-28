"""Owner-only encrypted integration credentials.

Revision ID: 0046_integration_credentials
Revises: 0045_research_privacy
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_integration_credentials"
down_revision: str = "0045_research_privacy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "integration_credentials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(12), nullable=False),
        sa.Column("wrapped_key", sa.LargeBinary(), nullable=False),
        sa.Column("key_nonce", sa.LargeBinary(12), nullable=False),
        sa.Column("key_id", sa.String(64), nullable=False),
        sa.Column("connected", sa.Boolean(), nullable=False),
        sa.Column("last_sync_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_code", sa.String(64)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "provider", name="uq_integration_owner_provider"),
        sa.CheckConstraint("provider IN ('zotero','webdav')", name="ck_integration_provider"),
        sa.CheckConstraint(
            "octet_length(nonce) = 12 AND octet_length(key_nonce) = 12",
            name="ck_integration_nonces",
        ),
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM integration_credentials)")):
        raise RuntimeError("Preserve integration credentials before downgrade.")
    op.drop_table("integration_credentials")
