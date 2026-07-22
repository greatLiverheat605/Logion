"""Add encrypted AI Provider configuration.

Revision ID: 0023_ai_provider
Revises: 0022_collaboration
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023_ai_provider"
down_revision: str | None = "0022_collaboration"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_providers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("normalized_name", sa.String(240), nullable=False),
        sa.Column("provider_type", sa.String(32), nullable=False),
        sa.Column("base_url", sa.String(2048), nullable=False),
        sa.Column("credential_ciphertext", sa.LargeBinary()),
        sa.Column("credential_nonce", sa.LargeBinary(12)),
        sa.Column("data_key_ciphertext", sa.LargeBinary()),
        sa.Column("data_key_nonce", sa.LargeBinary(12)),
        sa.Column("encryption_key_id", sa.String(64)),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("max_retries", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "provider_type = 'openai_compatible'", name="ck_ai_provider_supported_type"
        ),
        sa.CheckConstraint("timeout_seconds BETWEEN 1 AND 300", name="ck_ai_provider_timeout"),
        sa.CheckConstraint("max_retries BETWEEN 0 AND 5", name="ck_ai_provider_retries"),
    )
    op.create_index(
        "uq_ai_provider_active_name",
        "ai_providers",
        ["workspace_id", "normalized_name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_ai_provider_workspace_updated", "ai_providers", ["workspace_id", "updated_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_ai_provider_workspace_updated", table_name="ai_providers")
    op.drop_index("uq_ai_provider_active_name", table_name="ai_providers")
    op.drop_table("ai_providers")
