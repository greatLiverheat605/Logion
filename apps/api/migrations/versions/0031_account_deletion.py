"""Add recoverable account deletion lifecycle.

Revision ID: 0031_account_deletion
Revises: 0030_data_imports
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0031_account_deletion"
down_revision: str | None = "0030_data_imports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_users_status", "users", type_="check")
    op.create_check_constraint(
        "ck_users_status",
        "users",
        "status IN ('active', 'suspended', 'pending_deletion', 'deleted')",
    )
    op.create_table(
        "account_deletion_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "owned_workspace_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("policy_version", sa.String(32), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("delete_after", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancelled_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending','cancelled','completed')",
            name="ck_account_deletion_status",
        ),
    )
    op.create_index(
        "ix_account_deletion_due",
        "account_deletion_requests",
        ["status", "delete_after"],
    )


def downgrade() -> None:
    op.drop_index("ix_account_deletion_due", table_name="account_deletion_requests")
    op.drop_table("account_deletion_requests")
    op.drop_constraint("ck_users_status", "users", type_="check")
    op.create_check_constraint(
        "ck_users_status", "users", "status IN ('active', 'suspended', 'deleted')"
    )
