"""Add task state and study sessions.

Revision ID: 0011_task_sessions
Revises: 0010_planning_core
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_task_sessions"
down_revision: str | None = "0010_planning_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_plan_phase_workspace", "plan_phases", ["id", "workspace_id"])
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("goal_id", sa.Uuid(), nullable=False),
        sa.Column("phase_id", sa.Uuid()),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(20), nullable=False, server_default="backlog"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("planned_at", sa.DateTime(timezone=True)),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("blocked_reason", sa.String(500)),
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
        sa.ForeignKeyConstraint(
            ["goal_id", "workspace_id", "space_id"],
            ["learning_goals.id", "learning_goals.workspace_id", "learning_goals.space_id"],
            name="fk_task_goal_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["phase_id", "workspace_id"],
            ["plan_phases.id", "plan_phases.workspace_id"],
            name="fk_task_phase_workspace",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('backlog','planned','in_progress','submitted','verified','done',"
            "'blocked','cancelled')",
            name="ck_tasks_status",
        ),
        sa.CheckConstraint("priority BETWEEN 0 AND 4", name="ck_tasks_priority"),
        sa.CheckConstraint("estimated_minutes >= 0", name="ck_tasks_estimated_minutes"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_task_workspace"),
    )
    op.create_index("ix_tasks_workspace_status_due", "tasks", ["workspace_id", "status", "due_at"])
    op.create_index("ix_tasks_goal_status", "tasks", ["goal_id", "status"])
    op.create_table(
        "study_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("manual_minutes", sa.Integer()),
        sa.Column("reflection", sa.Text(), nullable=False, server_default=""),
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
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_study_session_task_workspace",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('active','completed','abandoned')", name="ck_study_sessions_status"
        ),
        sa.CheckConstraint(
            "manual_minutes IS NULL OR manual_minutes BETWEEN 0 AND 1440",
            name="ck_study_sessions_manual_minutes",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_study_session_workspace"),
    )
    op.create_index(
        "uq_active_session_actor_workspace",
        "study_sessions",
        ["workspace_id", "created_by"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index("ix_study_sessions_task_started", "study_sessions", ["task_id", "started_at"])
    op.create_table(
        "session_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(16), nullable=False),
        sa.Column(
            "occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("metadata", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(
            ["session_id", "workspace_id"],
            ["study_sessions.id", "study_sessions.workspace_id"],
            name="fk_session_event_session_workspace",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "event_type IN ('started','completed','abandoned')", name="ck_session_events_type"
        ),
        sa.CheckConstraint("jsonb_typeof(metadata) = 'object'", name="ck_session_event_metadata"),
    )
    op.create_index(
        "ix_session_events_session_time", "session_events", ["session_id", "occurred_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_session_events_session_time", table_name="session_events")
    op.drop_table("session_events")
    op.drop_index("ix_study_sessions_task_started", table_name="study_sessions")
    op.drop_index("uq_active_session_actor_workspace", table_name="study_sessions")
    op.drop_table("study_sessions")
    op.drop_index("ix_tasks_goal_status", table_name="tasks")
    op.drop_index("ix_tasks_workspace_status_due", table_name="tasks")
    op.drop_table("tasks")
    op.drop_constraint("uq_plan_phase_workspace", "plan_phases", type_="unique")
