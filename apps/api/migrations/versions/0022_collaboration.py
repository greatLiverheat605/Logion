"""Add explicit shared collaboration loop.

Revision ID: 0022_collaboration
Revises: 0021_research
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_collaboration"
down_revision: str | None = "0021_research"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def shared() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
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
    op.create_table(
        "rubrics",
        *shared(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("criteria", sa.Text(), nullable=False),
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_rubric_scope"),
    )
    op.create_index("ix_rubric_space", "rubrics", ["workspace_id", "space_id", "updated_at"])
    op.create_table(
        "group_review_requests",
        *shared(),
        sa.Column("rubric_id", sa.Uuid(), nullable=False),
        sa.Column("subject_title", sa.String(240), nullable=False),
        sa.Column("submission_summary", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["rubric_id", "workspace_id", "space_id"],
            ["rubrics.id", "rubrics.workspace_id", "rubrics.space_id"],
            name="fk_group_review_rubric_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_group_review_scope"),
    )
    op.create_table(
        "group_feedback",
        *shared(),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=False),
        sa.Column("recommended_action", sa.Text(), nullable=False, server_default=""),
        sa.ForeignKeyConstraint(
            ["review_id", "workspace_id", "space_id"],
            [
                "group_review_requests.id",
                "group_review_requests.workspace_id",
                "group_review_requests.space_id",
            ],
            name="fk_group_feedback_review_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_group_feedback_workspace"),
    )
    op.create_table(
        "report_snapshots",
        *shared(),
        sa.Column("review_id", sa.Uuid(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["review_id", "workspace_id", "space_id"],
            [
                "group_review_requests.id",
                "group_review_requests.workspace_id",
                "group_review_requests.space_id",
            ],
            name="fk_report_snapshot_review_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_report_snapshot_workspace"),
    )


def downgrade() -> None:
    for table in ("report_snapshots", "group_feedback", "group_review_requests"):
        op.drop_table(table)
    op.drop_index("ix_rubric_space", table_name="rubrics")
    op.drop_table("rubrics")
