"""Private close-reading notes reuse the existing Yjs document model."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0051_close_reading_notes"
down_revision: str | None = "0050_private_reading_topics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("note_kind", sa.String(32), nullable=True))
    op.add_column("notes", sa.Column("resource_id", sa.Uuid(), nullable=True))
    op.add_column("notes", sa.Column("research_owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_notes_research_owner_id_users",
        "notes",
        "users",
        ["research_owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_note_research_resource",
        "notes",
        "resources",
        ["resource_id", "workspace_id", "space_id", "research_owner_id"],
        ["id", "workspace_id", "space_id", "research_owner_id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_note_research_kind",
        "notes",
        "(note_kind IS NULL AND resource_id IS NULL AND research_owner_id IS NULL) OR "
        "(note_kind IS NOT NULL AND note_kind = 'close_reading' AND resource_id IS NOT NULL "
        "AND research_owner_id IS NOT NULL AND task_id IS NULL)",
    )
    op.create_unique_constraint(
        "uq_note_research_resource", "notes", ["resource_id", "research_owner_id"]
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM notes WHERE note_kind IS NOT NULL "
            "OR resource_id IS NOT NULL OR research_owner_id IS NOT NULL)"
        )
    ):
        raise RuntimeError("Preserve close-reading notes before downgrade.")
    op.drop_constraint("uq_note_research_resource", "notes", type_="unique")
    op.drop_constraint("ck_note_research_kind", "notes", type_="check")
    op.drop_constraint("fk_note_research_resource", "notes", type_="foreignkey")
    op.drop_constraint("fk_notes_research_owner_id_users", "notes", type_="foreignkey")
    for column in ("research_owner_id", "resource_id", "note_kind"):
        op.drop_column("notes", column)
