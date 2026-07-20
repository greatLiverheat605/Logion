"""Add one-time Workspace invitations.

Revision ID: 0006_invitation
Revises: 0005_workspace
Create Date: 2026-07-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_invitation"
down_revision: str | None = "0005_workspace"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_invitations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("email_normalized", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("invited_by", sa.Uuid(), nullable=False),
        sa.Column("accepted_by", sa.Uuid(), nullable=True),
        sa.Column("revoked_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('admin', 'editor', 'contributor', 'reviewer', 'viewer')",
            name="ck_workspace_invitations_role",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'revoked', 'expired')",
            name="ck_workspace_invitations_status",
        ),
        sa.ForeignKeyConstraint(["accepted_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invited_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_workspace_invitations_workspace_id",
        "workspace_invitations",
        ["workspace_id"],
    )
    op.create_index(
        "ix_workspace_invitations_workspace_email_status",
        "workspace_invitations",
        ["workspace_id", "email_normalized", "status"],
    )
    op.create_index(
        "ix_workspace_invitations_expiry",
        "workspace_invitations",
        ["status", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_invitations_expiry", table_name="workspace_invitations")
    op.drop_index(
        "ix_workspace_invitations_workspace_email_status",
        table_name="workspace_invitations",
    )
    op.drop_index("ix_workspace_invitations_workspace_id", table_name="workspace_invitations")
    op.drop_table("workspace_invitations")
