"""Allow archiving plan phases without deleting task references.

Revision ID: 0041_plan_phase_archived_at
Revises: 0040_merge_gate2_heads
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0041_plan_phase_archived_at"
down_revision: str = "0040_merge_gate2_heads"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "plan_phases",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("plan_phases", "archived_at")
