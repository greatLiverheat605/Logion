"""Add synchronized study-session lifecycle fields.

Revision ID: 0012_session_sync_fields
Revises: 0011_task_sessions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012_session_sync_fields"
down_revision: str | None = "0011_task_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("study_sessions", sa.Column("updated_by", sa.Uuid(), nullable=True))
    op.add_column("study_sessions", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE study_sessions SET updated_by = created_by WHERE updated_by IS NULL")
    op.alter_column("study_sessions", "updated_by", nullable=False)
    op.create_foreign_key(
        "fk_study_sessions_updated_by",
        "study_sessions",
        "users",
        ["updated_by"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint("fk_study_sessions_updated_by", "study_sessions", type_="foreignkey")
    op.drop_column("study_sessions", "deleted_at")
    op.drop_column("study_sessions", "updated_by")
