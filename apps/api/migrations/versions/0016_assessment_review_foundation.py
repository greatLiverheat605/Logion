"""Add private quizzes, error patterns, and audit reviews.

Revision ID: 0016_assessment_review
Revises: 0015_learning_science_foundation
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016_assessment_review"
down_revision: str | None = "0015_learning_science_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ERROR_CAUSES = "'recall_gap','concept_confusion','misread','careless','application_gap','unknown'"


def audit_columns() -> list[sa.Column[object]]:
    return [
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
    ]


def upgrade() -> None:
    op.drop_constraint("ck_review_schedule_source", "review_schedules", type_="check")
    op.create_check_constraint(
        "ck_review_schedule_source",
        "review_schedules",
        "source IN ('mastery_confirmation','manual','quiz_error')",
    )
    op.create_table(
        "quiz_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("answer_key", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("evaluation_mode", sa.String(20), nullable=False),
        *audit_columns(),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_quiz_item_topic_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "evaluation_mode IN ('exact_match','self_assessed')",
            name="ck_quiz_item_evaluation_mode",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_quiz_item_workspace"),
    )
    op.create_index(
        "ix_quiz_items_topic_updated", "quiz_items", ["workspace_id", "topic_id", "updated_at"]
    )
    op.create_table(
        "quiz_attempts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column("quiz_item_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("response_text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("error_cause", sa.String(24)),
        sa.Column(
            "attempted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        *audit_columns(),
        sa.ForeignKeyConstraint(
            ["quiz_item_id", "workspace_id"],
            ["quiz_items.id", "quiz_items.workspace_id"],
            name="fk_quiz_attempt_item_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_quiz_attempt_topic_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("confidence BETWEEN 1 AND 5", name="ck_quiz_attempt_confidence"),
        sa.CheckConstraint("duration_seconds BETWEEN 0 AND 86400", name="ck_quiz_attempt_duration"),
        sa.CheckConstraint(
            f"error_cause IS NULL OR error_cause IN ({ERROR_CAUSES})",
            name="ck_quiz_attempt_error_cause",
        ),
        sa.CheckConstraint(
            "is_correct = FALSE OR error_cause IS NULL",
            name="ck_quiz_attempt_correct_has_no_error",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_quiz_attempt_workspace"),
    )
    op.create_index(
        "ix_quiz_attempt_user_time",
        "quiz_attempts",
        ["workspace_id", "user_id", "attempted_at"],
    )
    op.create_table(
        "error_patterns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("topic_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("cause", sa.String(24), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("latest_attempt_id", sa.Uuid(), nullable=False),
        *audit_columns(),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_error_pattern_topic_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["latest_attempt_id", "workspace_id"],
            ["quiz_attempts.id", "quiz_attempts.workspace_id"],
            name="fk_error_pattern_latest_attempt_scope",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(f"cause IN ({ERROR_CAUSES})", name="ck_error_pattern_cause"),
        sa.CheckConstraint("status IN ('open','resolved')", name="ck_error_pattern_status"),
        sa.CheckConstraint("occurrence_count >= 1", name="ck_error_pattern_count"),
        sa.UniqueConstraint(
            "workspace_id", "topic_id", "user_id", "cause", name="uq_error_pattern_user_topic"
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_error_pattern_workspace"),
    )
    op.create_index(
        "ix_error_pattern_user_status",
        "error_patterns",
        ["workspace_id", "user_id", "status"],
    )
    op.create_table(
        "audit_reviews",
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
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("cadence", sa.String(12), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("completed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        *audit_columns(),
        sa.CheckConstraint("cadence IN ('daily','weekly')", name="ck_audit_review_cadence"),
        sa.CheckConstraint("status IN ('draft','completed')", name="ck_audit_review_status"),
        sa.CheckConstraint("period_start <= period_end", name="ck_audit_review_period"),
        sa.CheckConstraint(
            "(status = 'draft' AND completed_by IS NULL AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_audit_review_completion_shape",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "space_id",
            "user_id",
            "cadence",
            "period_start",
            "period_end",
            name="uq_audit_review_period",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_audit_review_workspace"),
    )
    op.create_index(
        "ix_audit_review_user_period",
        "audit_reviews",
        ["workspace_id", "user_id", "period_end"],
    )
    op.create_table(
        "review_findings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("audit_review_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("suggested_action", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        *audit_columns(),
        sa.ForeignKeyConstraint(
            ["audit_review_id", "workspace_id"],
            ["audit_reviews.id", "audit_reviews.workspace_id"],
            name="fk_review_finding_review_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "category IN ('progress','blocker','adjustment','error_pattern')",
            name="ck_review_finding_category",
        ),
        sa.CheckConstraint("status IN ('open','resolved')", name="ck_review_finding_status"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_review_finding_workspace"),
    )
    op.create_index(
        "ix_review_finding_user_status",
        "review_findings",
        ["workspace_id", "user_id", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_review_finding_user_status", table_name="review_findings")
    op.drop_table("review_findings")
    op.drop_index("ix_audit_review_user_period", table_name="audit_reviews")
    op.drop_table("audit_reviews")
    op.drop_index("ix_error_pattern_user_status", table_name="error_patterns")
    op.drop_table("error_patterns")
    op.drop_index("ix_quiz_attempt_user_time", table_name="quiz_attempts")
    op.drop_table("quiz_attempts")
    op.drop_index("ix_quiz_items_topic_updated", table_name="quiz_items")
    op.drop_table("quiz_items")
    op.drop_constraint("ck_review_schedule_source", "review_schedules", type_="check")
    op.create_check_constraint(
        "ck_review_schedule_source",
        "review_schedules",
        "source IN ('mastery_confirmation','manual')",
    )
