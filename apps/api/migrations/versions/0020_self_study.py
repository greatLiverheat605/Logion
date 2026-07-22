"""Add personal self-study loop.

Revision ID: 0020_self_study
Revises: 0019_mock_score
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020_self_study"
down_revision: str | None = "0019_mock_score"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def personal_columns() -> list[sa.Column]:
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


def upgrade() -> None:
    op.create_table(
        "learning_tracks",
        *personal_columns(),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("objective", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("id", "workspace_id", name="uq_learning_track_workspace"),
        sa.UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_learning_track_scope"
        ),
    )
    op.create_index(
        "ix_learning_track_user", "learning_tracks", ["workspace_id", "user_id", "updated_at"]
    )
    op.create_table(
        "study_projects",
        *personal_columns(),
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("intended_outcome", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["track_id", "workspace_id", "space_id", "user_id"],
            [
                "learning_tracks.id",
                "learning_tracks.workspace_id",
                "learning_tracks.space_id",
                "learning_tracks.user_id",
            ],
            name="fk_study_project_track_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_study_project_workspace"),
        sa.UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_study_project_scope"
        ),
    )
    op.create_index(
        "ix_study_project_track", "study_projects", ["workspace_id", "user_id", "track_id"]
    )
    op.create_table(
        "inbox_items",
        *personal_columns(),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("id", "workspace_id", name="uq_inbox_item_workspace"),
    )
    op.create_index("ix_inbox_item_user", "inbox_items", ["workspace_id", "user_id", "created_at"])
    op.create_table(
        "deliverables",
        *personal_columns(),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("evidence_summary", sa.Text(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id", "workspace_id", "space_id", "user_id"],
            [
                "study_projects.id",
                "study_projects.workspace_id",
                "study_projects.space_id",
                "study_projects.user_id",
            ],
            name="fk_deliverable_project_scope",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_deliverable_workspace"),
    )
    op.create_index(
        "ix_deliverable_project", "deliverables", ["workspace_id", "user_id", "project_id"]
    )


def downgrade() -> None:
    for table, index in (
        ("deliverables", "ix_deliverable_project"),
        ("inbox_items", "ix_inbox_item_user"),
        ("study_projects", "ix_study_project_track"),
        ("learning_tracks", "ix_learning_track_user"),
    ):
        op.drop_index(index, table_name=table)
        op.drop_table(table)
