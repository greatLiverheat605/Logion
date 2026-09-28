"""Private weekly reading tasks and review snapshots

Revision ID: 0055_weekly_reviews
Revises: 0054_knowledge_edges
Create Date: 2026-09-29 04:14:29.321210
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0055_weekly_reviews"
down_revision: str | None = "0054_knowledge_edges"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weekly_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("task_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("triage", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("ai_comment_run_id", sa.Uuid(), nullable=True),
        sa.Column("ai_comment", sa.Text(), nullable=True),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "jsonb_typeof(stats)='object' AND jsonb_typeof(task_snapshot)='array' "
            "AND jsonb_typeof(triage)='array'",
            name="ck_weekly_review_json",
        ),
        sa.CheckConstraint("extract(isodow from week_start)=1", name="ck_weekly_review_monday"),
        sa.CheckConstraint("version>=1", name="ck_weekly_review_version"),
        sa.ForeignKeyConstraint(
            ["ai_comment_run_id", "workspace_id"],
            ["ai_runs.id", "ai_runs.workspace_id"],
            name="fk_weekly_review_run",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_weekly_review_space",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "space_id", "week_start", name="uq_weekly_review_owner_week"
        ),
    )
    op.create_index(
        "ix_weekly_review_owner",
        "weekly_reviews",
        ["workspace_id", "space_id", "user_id", "week_start"],
        unique=False,
    )
    op.add_column("tasks", sa.Column("research_owner_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("resource_id", sa.Uuid(), nullable=True))
    op.add_column("tasks", sa.Column("reading_mode", sa.String(length=16), nullable=True))
    op.add_column("tasks", sa.Column("scheduled_on", sa.Date(), nullable=True))
    op.add_column(
        "tasks", sa.Column("reading_completed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index(
        "ix_task_research_week",
        "tasks",
        ["workspace_id", "space_id", "research_owner_id", "scheduled_on"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_task_research_resource",
        "tasks",
        "resources",
        ["resource_id", "workspace_id", "space_id", "research_owner_id"],
        ["id", "workspace_id", "space_id", "research_owner_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_task_research_owner",
        "tasks",
        "users",
        ["research_owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.create_check_constraint(
        "ck_task_research_shape",
        "tasks",
        "(research_owner_id IS NULL AND resource_id IS NULL AND reading_mode IS NULL "
        "AND scheduled_on IS NULL AND reading_completed_at IS NULL) OR "
        "(research_owner_id IS NOT NULL AND reading_mode IS NOT NULL AND "
        "reading_mode IN ('close_read','skim') AND scheduled_on IS NOT NULL "
        "AND created_by=research_owner_id)",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM weekly_reviews) OR EXISTS (SELECT 1 FROM tasks "
            "WHERE research_owner_id IS NOT NULL OR resource_id IS NOT NULL "
            "OR reading_mode IS NOT NULL "
            "OR scheduled_on IS NOT NULL OR reading_completed_at IS NOT NULL)"
        )
    ):
        raise RuntimeError("Preserve weekly review and reading plan data before downgrade.")
    op.drop_constraint("ck_task_research_shape", "tasks", type_="check")
    op.drop_constraint("fk_task_research_owner", "tasks", type_="foreignkey")
    op.drop_constraint("fk_task_research_resource", "tasks", type_="foreignkey")
    op.drop_index("ix_task_research_week", table_name="tasks")
    op.drop_column("tasks", "reading_completed_at")
    op.drop_column("tasks", "scheduled_on")
    op.drop_column("tasks", "reading_mode")
    op.drop_column("tasks", "resource_id")
    op.drop_column("tasks", "research_owner_id")
    op.drop_index("ix_weekly_review_owner", table_name="weekly_reviews")
    op.drop_table("weekly_reviews")
