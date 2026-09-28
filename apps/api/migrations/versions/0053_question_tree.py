"""Private research question hierarchy; preserve all existing question text."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0053_question_tree"
down_revision: str | None = "0052_reading_quizzes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "research_questions",
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
    )
    op.add_column("research_questions", sa.Column("parent_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_question_parent_scope",
        "research_questions",
        "research_questions",
        ["parent_id", "workspace_id", "space_id", "user_id"],
        ["id", "workspace_id", "space_id", "user_id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_question_status", "research_questions", "status IN ('active','answered','parked')"
    )
    op.create_check_constraint(
        "ck_question_not_self", "research_questions", "parent_id IS NULL OR parent_id <> id"
    )
    op.create_index(
        "ix_question_parent",
        "research_questions",
        ["workspace_id", "space_id", "user_id", "parent_id"],
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM research_questions)")):
        raise RuntimeError("Preserve research questions before downgrade.")
    op.drop_index("ix_question_parent", "research_questions")
    op.drop_constraint("ck_question_not_self", "research_questions", type_="check")
    op.drop_constraint("ck_question_status", "research_questions", type_="check")
    op.drop_constraint("fk_question_parent_scope", "research_questions", type_="foreignkey")
    op.drop_column("research_questions", "parent_id")
    op.drop_column("research_questions", "status")
