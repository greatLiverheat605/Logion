"""Add notifications and revocable calendar feeds.

Revision ID: 0028_engagement
Revises: 0027_templates_shares
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0028_engagement"
down_revision: str | None = "0027_templates_shares"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notification_preferences",
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("enabled_categories", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("quiet_start_minute", sa.Integer()),
        sa.Column("quiet_end_minute", sa.Integer()),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "quiet_start_minute IS NULL OR quiet_start_minute BETWEEN 0 AND 1439",
            name="ck_notification_quiet_start",
        ),
        sa.CheckConstraint(
            "quiet_end_minute IS NULL OR quiet_end_minute BETWEEN 0 AND 1439",
            name="ck_notification_quiet_end",
        ),
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recipient_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("target_type", sa.String(64)),
        sa.Column("target_id", sa.Uuid()),
        sa.Column("dedupe_key", sa.String(160), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "category IN ('learning','collaboration','sync','security','ai','billing','system')",
            name="ck_notification_category",
        ),
        sa.UniqueConstraint(
            "workspace_id", "recipient_user_id", "dedupe_key", name="uq_notification_dedupe"
        ),
    )
    op.create_index(
        "ix_notification_recipient_created",
        "notifications",
        ["workspace_id", "recipient_user_id", "created_at"],
    )
    op.create_table(
        "calendar_feeds",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('active','revoked')", name="ck_calendar_feed_status"),
    )
    op.create_index(
        "ix_calendar_feed_workspace_user",
        "calendar_feeds",
        ["workspace_id", "user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_calendar_feed_workspace_user", table_name="calendar_feeds")
    op.drop_table("calendar_feeds")
    op.drop_index("ix_notification_recipient_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_table("notification_preferences")
