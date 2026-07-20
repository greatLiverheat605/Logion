"""Create Workspace memberships and Space visibility boundaries.

Revision ID: 0005_workspace
Revises: 0004_totp
Create Date: 2026-07-20
"""

from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from uuid6 import uuid7

revision: str = "0005_workspace"
down_revision: str | None = "0004_totp"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')",
            name="ck_workspaces_status",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "workspace_memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'editor', 'contributor', 'reviewer', 'viewer')",
            name="ck_workspace_memberships_role",
        ),
        sa.CheckConstraint(
            "status IN ('invited', 'active', 'suspended', 'revoked')",
            name="ck_workspace_memberships_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "user_id",
            name="uq_membership_workspace_user",
        ),
    )
    op.create_index(
        "ix_workspace_memberships_workspace_id",
        "workspace_memberships",
        ["workspace_id"],
    )
    op.create_index(
        "ix_workspace_memberships_user_id",
        "workspace_memberships",
        ["user_id"],
    )
    op.create_index(
        "ix_workspace_memberships_user_status",
        "workspace_memberships",
        ["user_id", "status"],
    )

    op.create_table(
        "spaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("visibility", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("version", sa.BigInteger(), server_default="1", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
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
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "visibility IN ('private', 'shared')",
            name="ck_spaces_visibility",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'archived', 'deleted')",
            name="ck_spaces_status",
        ),
        sa.CheckConstraint(
            "visibility = 'shared' OR owner_user_id IS NOT NULL",
            name="ck_spaces_private_owner",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_spaces_workspace_id", "spaces", ["workspace_id"])
    op.create_index("ix_spaces_owner_user_id", "spaces", ["owner_user_id"])
    op.create_index(
        "ix_spaces_workspace_visibility",
        "spaces",
        ["workspace_id", "visibility", "status"],
    )
    _backfill_personal_workspaces()


def _backfill_personal_workspaces() -> None:
    users = sa.table("users", sa.column("id", sa.Uuid()))
    workspaces = sa.table(
        "workspaces",
        sa.column("id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("status", sa.String()),
        sa.column("version", sa.BigInteger()),
        sa.column("created_by", sa.Uuid()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    memberships = sa.table(
        "workspace_memberships",
        sa.column("id", sa.Uuid()),
        sa.column("workspace_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("role", sa.String()),
        sa.column("status", sa.String()),
        sa.column("version", sa.BigInteger()),
        sa.column("joined_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    spaces = sa.table(
        "spaces",
        sa.column("id", sa.Uuid()),
        sa.column("workspace_id", sa.Uuid()),
        sa.column("owner_user_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("visibility", sa.String()),
        sa.column("status", sa.String()),
        sa.column("version", sa.BigInteger()),
        sa.column("created_by", sa.Uuid()),
        sa.column("updated_by", sa.Uuid()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    audit_events = sa.table(
        "audit_events",
        sa.column("id", sa.Uuid()),
        sa.column("workspace_id", sa.Uuid()),
        sa.column("actor_id", sa.Uuid()),
        sa.column("request_id", sa.String()),
        sa.column("event_type", sa.String()),
        sa.column("target_type", sa.String()),
        sa.column("target_id", sa.Uuid()),
        sa.column("result", sa.String()),
        sa.column("metadata", sa.JSON()),
        sa.column("occurred_at", sa.DateTime(timezone=True)),
    )
    connection = op.get_bind()
    for user_id in connection.execute(sa.select(users.c.id)).scalars():
        now = datetime.now(UTC)
        workspace_id = uuid7()
        op.bulk_insert(
            workspaces,
            [
                {
                    "id": workspace_id,
                    "name": "Personal workspace",
                    "status": "active",
                    "version": 1,
                    "created_by": user_id,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        )
        op.bulk_insert(
            memberships,
            [
                {
                    "id": uuid7(),
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "role": "owner",
                    "status": "active",
                    "version": 1,
                    "joined_at": now,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        )
        op.bulk_insert(
            spaces,
            [
                {
                    "id": uuid7(),
                    "workspace_id": workspace_id,
                    "owner_user_id": user_id,
                    "name": "Private",
                    "visibility": "private",
                    "status": "active",
                    "version": 1,
                    "created_by": user_id,
                    "updated_by": user_id,
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        )
        op.bulk_insert(
            audit_events,
            [
                {
                    "id": uuid7(),
                    "workspace_id": workspace_id,
                    "actor_id": user_id,
                    "request_id": "migration:0005_workspace",
                    "event_type": "workspace.personal_backfilled",
                    "target_type": "workspace",
                    "target_id": workspace_id,
                    "result": "success",
                    "metadata": {"source": "migration"},
                    "occurred_at": now,
                }
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_spaces_workspace_visibility", table_name="spaces")
    op.drop_index("ix_spaces_owner_user_id", table_name="spaces")
    op.drop_index("ix_spaces_workspace_id", table_name="spaces")
    op.drop_table("spaces")
    op.drop_index("ix_workspace_memberships_user_status", table_name="workspace_memberships")
    op.drop_index("ix_workspace_memberships_user_id", table_name="workspace_memberships")
    op.drop_index("ix_workspace_memberships_workspace_id", table_name="workspace_memberships")
    op.drop_table("workspace_memberships")
    op.drop_table("workspaces")
