"""Add AI routing, model pricing, and workspace budgets.

Revision ID: 0025_ai_routing_budget
Revises: 0024_ai_models_health
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025_ai_routing_budget"
down_revision: str | None = "0024_ai_models_health"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "ai_models",
        sa.Column("pricing_currency", sa.String(3), nullable=False, server_default="USD"),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "input_cost_per_million_minor", sa.BigInteger(), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "ai_models",
        sa.Column(
            "output_cost_per_million_minor", sa.BigInteger(), nullable=False, server_default="0"
        ),
    )
    op.create_check_constraint(
        "ck_ai_model_pricing_nonnegative",
        "ai_models",
        "input_cost_per_million_minor >= 0 AND output_cost_per_million_minor >= 0",
    )
    op.create_table(
        "ai_workspace_budgets",
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("monthly_token_budget", sa.BigInteger()),
        sa.Column("monthly_cost_budget_minor", sa.BigInteger()),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "monthly_token_budget IS NULL OR monthly_token_budget > 0",
            name="ck_ai_budget_tokens_positive",
        ),
        sa.CheckConstraint(
            "monthly_cost_budget_minor IS NULL OR monthly_cost_budget_minor > 0",
            name="ck_ai_budget_cost_positive",
        ),
    )
    op.create_table(
        "ai_task_routes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("normalized_name", sa.String(240), nullable=False),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("requires_json", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("requires_stream", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_input_tokens", sa.Integer(), nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
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
        sa.CheckConstraint("max_input_tokens > 0", name="ck_ai_route_input_positive"),
        sa.CheckConstraint("max_output_tokens > 0", name="ck_ai_route_output_positive"),
    )
    op.create_index(
        "uq_ai_route_active_name",
        "ai_task_routes",
        ["workspace_id", "normalized_name"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "uq_ai_route_active_task_type",
        "ai_task_routes",
        ["workspace_id", "task_type"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND enabled"),
    )
    op.create_table(
        "ai_task_route_targets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            sa.Uuid(),
            sa.ForeignKey("ai_task_routes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "model_id",
            sa.Uuid(),
            sa.ForeignKey("ai_models.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_ai_route_target_position"),
        sa.UniqueConstraint("route_id", "position", name="uq_ai_route_target_position"),
        sa.UniqueConstraint("route_id", "model_id", name="uq_ai_route_target_model"),
    )
    op.create_index(
        "ix_ai_route_target_workspace_route",
        "ai_task_route_targets",
        ["workspace_id", "route_id", "position"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_route_target_workspace_route", table_name="ai_task_route_targets")
    op.drop_table("ai_task_route_targets")
    op.drop_index("uq_ai_route_active_task_type", table_name="ai_task_routes")
    op.drop_index("uq_ai_route_active_name", table_name="ai_task_routes")
    op.drop_table("ai_task_routes")
    op.drop_table("ai_workspace_budgets")
    op.drop_constraint("ck_ai_model_pricing_nonnegative", "ai_models", type_="check")
    op.drop_column("ai_models", "output_cost_per_million_minor")
    op.drop_column("ai_models", "input_cost_per_million_minor")
    op.drop_column("ai_models", "pricing_currency")
