"""Add AI model discovery and Provider health metadata.

Revision ID: 0024_ai_models_health
Revises: 0023_ai_provider
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024_ai_models_health"
down_revision: str | None = "0023_ai_provider"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_providers",
        sa.Column("last_health_status", sa.String(16), nullable=False, server_default="unknown"),
    )
    op.add_column("ai_providers", sa.Column("last_health_checked_at", sa.DateTime(timezone=True)))
    op.add_column("ai_providers", sa.Column("last_health_error_code", sa.String(64)))
    op.create_check_constraint(
        "ck_ai_provider_health_status",
        "ai_providers",
        "last_health_status IN ('unknown', 'healthy', 'unhealthy')",
    )
    op.create_table(
        "ai_models",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "provider_id",
            sa.Uuid(),
            sa.ForeignKey("ai_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider_model_id", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("source", sa.String(16), nullable=False, server_default="discovered"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("supports_json", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("supports_stream", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("context_window", sa.Integer()),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("source IN ('discovered', 'manual')", name="ck_ai_model_source"),
        sa.CheckConstraint(
            "context_window IS NULL OR context_window > 0", name="ck_ai_model_context_window"
        ),
    )
    op.create_index(
        "uq_ai_model_active_provider_id",
        "ai_models",
        ["workspace_id", "provider_id", "provider_model_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_ai_model_workspace_provider",
        "ai_models",
        ["workspace_id", "provider_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_model_workspace_provider", table_name="ai_models")
    op.drop_index("uq_ai_model_active_provider_id", table_name="ai_models")
    op.drop_table("ai_models")
    op.drop_constraint("ck_ai_provider_health_status", "ai_providers", type_="check")
    op.drop_column("ai_providers", "last_health_error_code")
    op.drop_column("ai_providers", "last_health_checked_at")
    op.drop_column("ai_providers", "last_health_status")
