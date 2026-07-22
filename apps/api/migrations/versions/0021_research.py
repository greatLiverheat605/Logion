"""Add personal research evidence records.

Revision ID: 0021_research
Revises: 0020_self_study
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021_research"
down_revision: str | None = "0020_self_study"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def personal() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
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


def scope(name: str) -> sa.UniqueConstraint:
    return sa.UniqueConstraint("id", "workspace_id", "space_id", "user_id", name=name)


def upgrade() -> None:
    op.create_table(
        "paper_records",
        *personal(),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("citation_key", sa.String(160), nullable=False),
        sa.Column("source_url", sa.String(2000)),
        sa.UniqueConstraint("id", "workspace_id", name="uq_paper_record_workspace"),
        scope("uq_paper_record_scope"),
    )
    op.create_index(
        "ix_paper_record_user", "paper_records", ["workspace_id", "user_id", "updated_at"]
    )
    op.create_table(
        "research_claims",
        *personal(),
        sa.Column("paper_id", sa.Uuid(), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("stance", sa.String(16), nullable=False),
        sa.ForeignKeyConstraint(
            ["paper_id", "workspace_id", "space_id", "user_id"],
            [
                "paper_records.id",
                "paper_records.workspace_id",
                "paper_records.space_id",
                "paper_records.user_id",
            ],
            name="fk_research_claim_paper_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "stance IN ('supports','opposes','mixed','unknown')", name="ck_research_claim_stance"
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_research_claim_workspace"),
        scope("uq_research_claim_scope"),
    )
    op.create_table(
        "research_questions",
        *personal(),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("id", "workspace_id", name="uq_research_question_workspace"),
        scope("uq_research_question_scope"),
    )
    op.create_table(
        "experiment_runs",
        *personal(),
        sa.Column("question_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("method_summary", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["question_id", "workspace_id", "space_id", "user_id"],
            [
                "research_questions.id",
                "research_questions.workspace_id",
                "research_questions.space_id",
                "research_questions.user_id",
            ],
            name="fk_experiment_run_question_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_experiment_run_workspace"),
        scope("uq_experiment_run_scope"),
    )
    op.create_table(
        "metric_records",
        *personal(),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(80), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["run_id", "workspace_id", "space_id", "user_id"],
            [
                "experiment_runs.id",
                "experiment_runs.workspace_id",
                "experiment_runs.space_id",
                "experiment_runs.user_id",
            ],
            name="fk_metric_record_run_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_metric_record_workspace"),
    )
    op.create_table(
        "research_feedback",
        *personal(),
        sa.Column("claim_id", sa.Uuid(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("requested_action", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["claim_id", "workspace_id", "space_id", "user_id"],
            [
                "research_claims.id",
                "research_claims.workspace_id",
                "research_claims.space_id",
                "research_claims.user_id",
            ],
            name="fk_research_feedback_claim_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_research_feedback_workspace"),
    )


def downgrade() -> None:
    for table in (
        "research_feedback",
        "metric_records",
        "experiment_runs",
        "research_questions",
        "research_claims",
    ):
        op.drop_table(table)
    op.drop_index("ix_paper_record_user", table_name="paper_records")
    op.drop_table("paper_records")
