"""Owner-only concepts derived from private research excerpts."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0050_private_reading_topics"
down_revision: str | None = "0049_source_texts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("topics", sa.Column("research_owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_topics_research_owner_id_users",
        "topics",
        "users",
        ["research_owner_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM topics WHERE research_owner_id IS NOT NULL)")
    ):
        raise RuntimeError("Preserve private reading concepts before downgrade.")
    op.drop_constraint("fk_topics_research_owner_id_users", "topics", type_="foreignkey")
    op.drop_column("topics", "research_owner_id")
