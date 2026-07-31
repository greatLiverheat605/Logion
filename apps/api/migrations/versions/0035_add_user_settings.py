"""Add versioned user settings.

Revision ID: 0035_add_user_settings
Revises: 0034_sync_conflicts
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035_add_user_settings"
down_revision: str | None = "0034_sync_conflicts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(length=128), nullable=False),
        sa.Column("value", sa.String(length=8192), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_user_settings_version"),
        sa.PrimaryKeyConstraint("user_id", "key"),
    )


def downgrade() -> None:
    op.drop_table("user_settings")
