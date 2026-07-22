"""Add personal mock exams and append-only score records.

Revision ID: 0019_mock_score
Revises: 0018_subject_syllabus
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019_mock_score"
down_revision: str | None = "0018_subject_syllabus"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mock_exams",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("exam_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("duration_limit_seconds", sa.Integer(), nullable=False),
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
            ["exam_id", "workspace_id", "space_id", "user_id"],
            ["exams.id", "exams.workspace_id", "exams.space_id", "exams.user_id"],
            name="fk_mock_exam_exam_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "duration_limit_seconds BETWEEN 60 AND 86400", name="ck_mock_exam_duration_limit"
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_mock_exam_workspace"),
        sa.UniqueConstraint("id", "workspace_id", "space_id", "user_id", name="uq_mock_exam_scope"),
    )
    op.create_index("ix_mock_exam_user_exam", "mock_exams", ["workspace_id", "user_id", "exam_id"])
    op.create_table(
        "score_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("mock_exam_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("score_scale_max", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
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
            ["mock_exam_id", "workspace_id", "space_id", "user_id"],
            [
                "mock_exams.id",
                "mock_exams.workspace_id",
                "mock_exams.space_id",
                "mock_exams.user_id",
            ],
            name="fk_score_record_mock_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "score BETWEEN 0 AND score_scale_max AND score_scale_max BETWEEN 1 AND 1000000",
            name="ck_score_record_score",
        ),
        sa.CheckConstraint("duration_seconds BETWEEN 0 AND 86400", name="ck_score_record_duration"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_score_record_workspace"),
    )
    op.create_index(
        "ix_score_record_user_time", "score_records", ["workspace_id", "user_id", "completed_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_score_record_user_time", table_name="score_records")
    op.drop_table("score_records")
    op.drop_index("ix_mock_exam_user_exam", table_name="mock_exams")
    op.drop_table("mock_exams")
