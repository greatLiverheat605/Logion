"""Add goals, versioned plans, and ordered phases.

Revision ID: 0010_planning_core
Revises: 0009_sync_ledger
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_planning_core"
down_revision: str | None = "0009_sync_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "learning_goals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "space_id", sa.Uuid(), sa.ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("desired_outcome", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("weekly_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("target_date", sa.Date()),
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
            "status IN ('draft', 'active', 'completed', 'archived')",
            name="ck_learning_goals_status",
        ),
        sa.CheckConstraint("weekly_minutes BETWEEN 0 AND 10080", name="ck_goal_weekly_minutes"),
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_goal_scope"),
    )
    op.create_index(
        "ix_learning_goals_space_status", "learning_goals", ["workspace_id", "space_id", "status"]
    )
    op.create_table(
        "learning_plans",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("goal_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["goal_id", "workspace_id", "space_id"],
            ["learning_goals.id", "learning_goals.workspace_id", "learning_goals.space_id"],
            name="fk_learning_plan_goal_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'archived')", name="ck_learning_plans_status"
        ),
        sa.UniqueConstraint("goal_id", name="uq_learning_plan_goal"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_learning_plan_workspace"),
    )
    op.create_table(
        "plan_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("change_summary", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["plan_id", "workspace_id"],
            ["learning_plans.id", "learning_plans.workspace_id"],
            name="fk_plan_version_plan_workspace",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'published', 'superseded')", name="ck_plan_versions_status"
        ),
        sa.UniqueConstraint("plan_id", "version_number", name="uq_plan_version_number"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_plan_version_workspace"),
    )
    op.create_table(
        "plan_phases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("plan_version_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("acceptance_criteria", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["plan_version_id", "workspace_id"],
            ["plan_versions.id", "plan_versions.workspace_id"],
            name="fk_plan_phase_version_workspace",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("position >= 0", name="ck_plan_phases_position"),
        sa.CheckConstraint("estimated_minutes >= 0", name="ck_plan_phases_estimated_minutes"),
        sa.CheckConstraint("jsonb_typeof(acceptance_criteria) = 'array'", name="ck_phase_criteria"),
        sa.UniqueConstraint("plan_version_id", "position", name="uq_plan_phase_position"),
    )
    op.create_index(
        "ix_plan_phases_version_position", "plan_phases", ["plan_version_id", "position"]
    )


def downgrade() -> None:
    op.drop_index("ix_plan_phases_version_position", table_name="plan_phases")
    op.drop_table("plan_phases")
    op.drop_table("plan_versions")
    op.drop_table("learning_plans")
    op.drop_index("ix_learning_goals_space_status", table_name="learning_goals")
    op.drop_table("learning_goals")
