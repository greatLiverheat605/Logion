"""Private per-paper quiz provenance and AI grading evidence."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052_reading_quizzes"
down_revision: str | None = "0051_close_reading_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_ai_run_workspace", "ai_runs", ["id", "workspace_id"])
    op.create_unique_constraint(
        "uq_topic_research_scope", "topics", ["id", "workspace_id", "space_id", "research_owner_id"]
    )
    for column in ("resource_id", "research_owner_id", "ai_run_id"):
        op.add_column("quiz_items", sa.Column(column, sa.Uuid(), nullable=True))
    op.add_column("quiz_items", sa.Column("origin", sa.String(16), nullable=True))
    op.create_foreign_key(
        "fk_quiz_items_research_owner_id_users",
        "quiz_items",
        "users",
        ["research_owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_quiz_research_resource",
        "quiz_items",
        "resources",
        ["resource_id", "workspace_id", "space_id", "research_owner_id"],
        ["id", "workspace_id", "space_id", "research_owner_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_quiz_research_topic",
        "quiz_items",
        "topics",
        ["topic_id", "workspace_id", "space_id", "research_owner_id"],
        ["id", "workspace_id", "space_id", "research_owner_id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_quiz_research_run",
        "quiz_items",
        "ai_runs",
        ["ai_run_id", "workspace_id"],
        ["id", "workspace_id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_quiz_research_shape",
        "quiz_items",
        "(resource_id IS NULL AND research_owner_id IS NULL "
        "AND origin IS NULL AND ai_run_id IS NULL) OR "
        "(resource_id IS NOT NULL AND research_owner_id IS NOT NULL AND origin IS NOT NULL AND "
        "((origin = 'user' AND ai_run_id IS NULL) OR (origin = 'ai' AND ai_run_id IS NOT NULL)))",
    )
    op.create_index("ix_quiz_research_resource", "quiz_items", ["resource_id", "research_owner_id"])
    op.add_column("quiz_attempts", sa.Column("ai_grade", postgresql.JSONB(), nullable=True))
    op.create_check_constraint(
        "ck_quiz_attempt_ai_grade",
        "quiz_attempts",
        "ai_grade IS NULL OR jsonb_typeof(ai_grade) = 'object'",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM quiz_items WHERE resource_id IS NOT NULL OR "
            "research_owner_id IS NOT NULL OR origin IS NOT NULL OR ai_run_id IS NOT NULL) "
            "OR EXISTS (SELECT 1 FROM quiz_attempts WHERE ai_grade IS NOT NULL)"
        )
    ):
        raise RuntimeError("Preserve reading quizzes and grading evidence before downgrade.")
    op.drop_constraint("ck_quiz_attempt_ai_grade", "quiz_attempts", type_="check")
    op.drop_column("quiz_attempts", "ai_grade")
    op.drop_index("ix_quiz_research_resource", "quiz_items")
    op.drop_constraint("ck_quiz_research_shape", "quiz_items", type_="check")
    for name in (
        "fk_quiz_research_run",
        "fk_quiz_research_topic",
        "fk_quiz_research_resource",
        "fk_quiz_items_research_owner_id_users",
    ):
        op.drop_constraint(name, "quiz_items", type_="foreignkey")
    for column in ("origin", "ai_run_id", "research_owner_id", "resource_id"):
        op.drop_column("quiz_items", column)
    op.drop_constraint("uq_topic_research_scope", "topics", type_="unique")
    op.drop_constraint("uq_ai_run_workspace", "ai_runs", type_="unique")
