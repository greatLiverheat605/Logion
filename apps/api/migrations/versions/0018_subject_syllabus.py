"""Add personal exam subjects and syllabus hierarchy.

Revision ID: 0018_subject_syllabus
Revises: 0017_exam
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018_subject_syllabus"
down_revision: str | None = "0017_exam"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_exam_personal_scope", "exams", ["id", "workspace_id", "space_id", "user_id"]
    )
    op.create_table(
        "exam_subjects",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("exam_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("weight_basis_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
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
            name="fk_exam_subject_exam_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "weight_basis_points BETWEEN 0 AND 10000", name="ck_exam_subject_weight"
        ),
        sa.CheckConstraint("status IN ('active','archived')", name="ck_exam_subject_status"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_exam_subject_workspace"),
        sa.UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_exam_subject_scope"
        ),
        sa.UniqueConstraint("exam_id", "user_id", "name", name="uq_exam_subject_name"),
    )
    op.create_index(
        "ix_exam_subject_user_exam", "exam_subjects", ["workspace_id", "user_id", "exam_id"]
    )
    op.create_table(
        "syllabus_nodes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid()),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(240), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("coverage_status", sa.String(20), nullable=False, server_default="not_started"),
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
            ["subject_id", "workspace_id", "space_id", "user_id"],
            [
                "exam_subjects.id",
                "exam_subjects.workspace_id",
                "exam_subjects.space_id",
                "exam_subjects.user_id",
            ],
            name="fk_syllabus_node_subject_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id", "subject_id", "workspace_id", "space_id", "user_id"],
            [
                "syllabus_nodes.id",
                "syllabus_nodes.subject_id",
                "syllabus_nodes.workspace_id",
                "syllabus_nodes.space_id",
                "syllabus_nodes.user_id",
            ],
            name="fk_syllabus_node_parent_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="ck_syllabus_node_not_self"
        ),
        sa.CheckConstraint("importance BETWEEN 1 AND 5", name="ck_syllabus_node_importance"),
        sa.CheckConstraint(
            "coverage_status IN ('not_started','in_progress','covered')",
            name="ck_syllabus_node_coverage",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_syllabus_node_workspace"),
        sa.UniqueConstraint(
            "id", "subject_id", "workspace_id", "space_id", "user_id", name="uq_syllabus_node_scope"
        ),
    )
    op.create_index(
        "ix_syllabus_node_subject", "syllabus_nodes", ["workspace_id", "user_id", "subject_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_syllabus_node_subject", table_name="syllabus_nodes")
    op.drop_table("syllabus_nodes")
    op.drop_index("ix_exam_subject_user_exam", table_name="exam_subjects")
    op.drop_table("exam_subjects")
    op.drop_constraint("uq_exam_personal_scope", "exams", type_="unique")
