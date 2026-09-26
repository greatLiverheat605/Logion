"""Add navigation links from note excerpts to topics and recall items.

Revision ID: 0042_knowledge_source_links
Revises: 0041_plan_phase_archived_at
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0042_knowledge_source_links"
down_revision: str = "0041_plan_phase_archived_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_source_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("source_kind", sa.String(length=16), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("excerpt_sha256", sa.String(length=64), nullable=False),
        sa.Column("excerpt_start", sa.Integer(), nullable=True),
        sa.Column("excerpt_end", sa.Integer(), nullable=True),
        sa.Column("source_version", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("source_kind IN ('note')", name="ck_source_link_source_kind"),
        sa.CheckConstraint(
            "target_kind IN ('topic', 'quiz_item')", name="ck_source_link_target_kind"
        ),
        sa.CheckConstraint(
            "excerpt_start IS NULL OR (excerpt_start >= 0 AND excerpt_end > excerpt_start)",
            name="ck_source_link_excerpt_range",
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_source_link_space_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_source_links_workspace_source",
        "knowledge_source_links",
        ["workspace_id", "source_id"],
    )
    op.create_index(
        "ix_source_links_workspace_target",
        "knowledge_source_links",
        ["workspace_id", "target_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_source_links_workspace_target", table_name="knowledge_source_links")
    op.drop_index("ix_source_links_workspace_source", table_name="knowledge_source_links")
    op.drop_table("knowledge_source_links")
