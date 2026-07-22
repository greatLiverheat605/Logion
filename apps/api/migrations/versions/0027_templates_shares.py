"""Add versioned templates and revocable read-only shares.

Revision ID: 0027_templates_shares
Revises: 0026_ai_runs_drafts
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027_templates_shares"
down_revision: str | None = "0026_ai_runs_drafts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "template_packages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("template_key", sa.Uuid(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.String(1000), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("product_min_version", sa.String(32), nullable=False),
        sa.Column("author_name", sa.String(120), nullable=False),
        sa.Column("license", sa.String(80), nullable=False),
        sa.Column("locale", sa.String(35), nullable=False),
        sa.Column("target_personas", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("changelog", sa.String(2000), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("risk_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("object_graph", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False, server_default="private"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "version_number > 0 AND schema_version > 0", name="ck_template_versions_positive"
        ),
        sa.CheckConstraint("status IN ('active','withdrawn')", name="ck_template_status"),
        sa.CheckConstraint("visibility IN ('private','workspace')", name="ck_template_visibility"),
        sa.UniqueConstraint(
            "workspace_id", "template_key", "version_number", name="uq_template_version"
        ),
    )
    op.create_index(
        "ix_template_workspace_created", "template_packages", ["workspace_id", "created_at"]
    )
    op.create_table(
        "template_installations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "space_id", sa.Uuid(), sa.ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "template_id",
            sa.Uuid(),
            sa.ForeignKey("template_packages.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("template_content_hash", sa.String(64), nullable=False),
        sa.Column("installed_object_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "installed_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(
        "ix_template_install_workspace", "template_installations", ["workspace_id", "created_at"]
    )
    op.create_table(
        "share_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "space_id", sa.Uuid(), sa.ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("object_type", sa.String(32), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("revoked_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("object_type = 'goal_plan'", name="ck_share_object_type"),
        sa.CheckConstraint("status IN ('active','revoked')", name="ck_share_status"),
    )
    op.create_index("ix_share_workspace_created", "share_snapshots", ["workspace_id", "created_at"])
    op.create_index("ix_share_expiry", "share_snapshots", ["status", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_share_expiry", table_name="share_snapshots")
    op.drop_index("ix_share_workspace_created", table_name="share_snapshots")
    op.drop_table("share_snapshots")
    op.drop_index("ix_template_install_workspace", table_name="template_installations")
    op.drop_table("template_installations")
    op.drop_index("ix_template_workspace_created", table_name="template_packages")
    op.drop_table("template_packages")
