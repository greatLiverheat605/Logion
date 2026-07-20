"""Add email verification actions and encrypted delivery outbox.

Revision ID: 0008_email_verification
Revises: 0007_audit_query
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_email_verification"
down_revision: str | None = "0007_audit_query"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "identity_action_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("failed_attempts", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_recovery')",
            name="ck_identity_action_tokens_purpose",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_identity_action_tokens_user_id",
        "identity_action_tokens",
        ["user_id"],
    )
    op.create_index(
        "ix_identity_action_tokens_user_purpose_active",
        "identity_action_tokens",
        ["user_id", "purpose", "used_at", "revoked_at"],
    )
    op.create_index(
        "ix_identity_action_tokens_expiry",
        "identity_action_tokens",
        ["purpose", "expires_at"],
    )

    op.create_table(
        "email_outbox",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("action_token_id", sa.Uuid(), nullable=True),
        sa.Column("purpose", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("encryption_key_id", sa.String(length=64), nullable=False),
        sa.Column("payload_ciphertext", sa.LargeBinary(length=4096), nullable=False),
        sa.Column("payload_nonce", sa.LargeBinary(length=12), nullable=False),
        sa.Column("attempts", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("terminal_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('email_verification', 'password_recovery', 'security_notification')",
            name="ck_email_outbox_purpose",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'leased', 'sent', 'failed', 'dead')",
            name="ck_email_outbox_status",
        ),
        sa.ForeignKeyConstraint(
            ["action_token_id"],
            ["identity_action_tokens.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_outbox_user_id", "email_outbox", ["user_id"])
    op.create_index(
        "ix_email_outbox_action_token_id",
        "email_outbox",
        ["action_token_id"],
    )
    op.create_index(
        "ix_email_outbox_delivery",
        "email_outbox",
        ["status", "available_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_outbox_delivery", table_name="email_outbox")
    op.drop_index("ix_email_outbox_action_token_id", table_name="email_outbox")
    op.drop_index("ix_email_outbox_user_id", table_name="email_outbox")
    op.drop_table("email_outbox")
    op.drop_index("ix_identity_action_tokens_expiry", table_name="identity_action_tokens")
    op.drop_index(
        "ix_identity_action_tokens_user_purpose_active",
        table_name="identity_action_tokens",
    )
    op.drop_index("ix_identity_action_tokens_user_id", table_name="identity_action_tokens")
    op.drop_table("identity_action_tokens")
