"""Add mergeable Yjs state to Markdown notes.

Revision ID: 0033_note_yjs_state
Revises: 0032_attachments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from pycrdt import Doc, Text

revision: str = "0033_note_yjs_state"
down_revision: str | None = "0032_attachments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notes", sa.Column("yjs_state", sa.LargeBinary(), nullable=True))
    op.add_column(
        "notes",
        sa.Column("yjs_generation", sa.BigInteger(), server_default=sa.text("1"), nullable=False),
    )
    connection = op.get_bind()
    notes = connection.execute(sa.text("SELECT id, markdown_body FROM notes")).mappings()
    for note in notes:
        state = Doc({"markdown": Text(note["markdown_body"])}).get_update()
        connection.execute(
            sa.text("UPDATE notes SET yjs_state = :state WHERE id = :id"),
            {"state": state, "id": note["id"]},
        )
    op.alter_column("notes", "yjs_state", existing_type=sa.LargeBinary(), nullable=False)


def downgrade() -> None:
    op.drop_column("notes", "yjs_generation")
    op.drop_column("notes", "yjs_state")
