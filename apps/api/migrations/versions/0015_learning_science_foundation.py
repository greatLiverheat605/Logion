"""Add topics, mastery records, and review schedules.

Revision ID: 0015_learning_science_foundation
Revises: 0014_evidence_verification
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015_learning_science_foundation"
down_revision: str | None = "0014_evidence_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

MASTERY_LEVEL_SQL = "'unknown','exposed','practicing','familiar','proficient','mastered'"


def upgrade() -> None:
    op.create_table(
        "topics",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "space_id",
            sa.Uuid(),
            sa.ForeignKey("spaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
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
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_topic_scope"),
    )
    op.create_index(
        "ix_topics_workspace_space_updated",
        "topics",
        ["workspace_id", "space_id", "updated_at"],
    )

    op.create_table(
        "topic_dependencies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("prerequisite_topic_id", sa.Uuid(), nullable=False),
        sa.Column("dependent_topic_id", sa.Uuid(), nullable=False),
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
            ["prerequisite_topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_topic_dependency_prerequisite_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["dependent_topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_topic_dependency_dependent_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "prerequisite_topic_id <> dependent_topic_id",
            name="ck_topic_dependency_not_self",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "space_id",
            "prerequisite_topic_id",
            "dependent_topic_id",
            name="uq_topic_dependency_edge",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_topic_dependency_workspace"),
    )
    op.create_index(
        "ix_topic_dependencies_dependent", "topic_dependencies", ["dependent_topic_id"]
    )

    op.create_table(
        "mastery_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "suggested_level", sa.String(20), nullable=False, server_default="unknown"
        ),
        sa.Column("suggested_reason", sa.String(500), nullable=False, server_default=""),
        sa.Column("suggested_at", sa.DateTime(timezone=True)),
        sa.Column("confirmed_level", sa.String(20)),
        sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_mastery_topic_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            f"suggested_level IN ({MASTERY_LEVEL_SQL})",
            name="ck_mastery_suggested_level",
        ),
        sa.CheckConstraint(
            f"confirmed_level IS NULL OR confirmed_level IN ({MASTERY_LEVEL_SQL})",
            name="ck_mastery_confirmed_level",
        ),
        sa.CheckConstraint(
            "(confirmed_level IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL) OR "
            "(confirmed_level IS NOT NULL AND confirmed_by IS NOT NULL "
            "AND confirmed_at IS NOT NULL)",
            name="ck_mastery_confirmation_shape",
        ),
        sa.UniqueConstraint("workspace_id", "topic_id", "user_id", name="uq_mastery_topic_user"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_mastery_workspace"),
    )
    op.create_index(
        "ix_mastery_user_level",
        "mastery_records",
        ["workspace_id", "user_id", "confirmed_level"],
    )

    op.create_table(
        "review_schedules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="scheduled"),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=False),
        sa.Column("next_review_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_review_schedule_topic_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "status IN ('scheduled','due','in_progress','completed','skipped')",
            name="ck_review_schedule_status",
        ),
        sa.CheckConstraint(
            "source IN ('mastery_confirmation','manual')",
            name="ck_review_schedule_source",
        ),
        sa.CheckConstraint(
            "interval_days BETWEEN 1 AND 3650", name="ck_review_interval_days"
        ),
        sa.UniqueConstraint(
            "workspace_id", "topic_id", "user_id", name="uq_review_schedule_topic_user"
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_review_schedule_workspace"),
    )
    op.create_index(
        "ix_review_schedule_user_due",
        "review_schedules",
        ["workspace_id", "user_id", "next_review_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_schedule_user_due", table_name="review_schedules")
    op.drop_table("review_schedules")
    op.drop_index("ix_mastery_user_level", table_name="mastery_records")
    op.drop_table("mastery_records")
    op.drop_index("ix_topic_dependencies_dependent", table_name="topic_dependencies")
    op.drop_table("topic_dependencies")
    op.drop_index("ix_topics_workspace_space_updated", table_name="topics")
    op.drop_table("topics")
