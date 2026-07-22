"""Add personal exam countdown records.

Revision ID: 0017_exam
Revises: 0016_assessment_review
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017_exam"
down_revision: str | None = "0016_assessment_review"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exams",
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
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("date_status", sa.String(20), nullable=False),
        sa.Column("exam_at", sa.DateTime(timezone=True)),
        sa.Column("timezone", sa.String(64)),
        sa.Column("target_score", sa.Integer()),
        sa.Column("score_scale_max", sa.Integer()),
        sa.Column("status", sa.String(16), nullable=False, server_default="planning"),
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
            "date_status IN ('scheduled','undetermined')", name="ck_exam_date_status"
        ),
        sa.CheckConstraint(
            "status IN ('planning','active','completed','archived')",
            name="ck_exam_status",
        ),
        sa.CheckConstraint(
            "(date_status = 'scheduled' AND exam_at IS NOT NULL AND timezone IS NOT NULL) OR "
            "(date_status = 'undetermined' AND exam_at IS NULL)",
            name="ck_exam_date_shape",
        ),
        sa.CheckConstraint(
            "(target_score IS NULL AND score_scale_max IS NULL) OR "
            "(target_score BETWEEN 0 AND score_scale_max "
            "AND score_scale_max BETWEEN 1 AND 1000000)",
            name="ck_exam_target_score",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_exam_workspace"),
    )
    op.create_index("ix_exam_user_date", "exams", ["workspace_id", "user_id", "exam_at"])


def downgrade() -> None:
    op.drop_index("ix_exam_user_date", table_name="exams")
    op.drop_table("exams")
