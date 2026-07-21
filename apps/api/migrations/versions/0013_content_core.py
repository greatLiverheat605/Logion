"""Add Markdown notes and resource indexes.

Revision ID: 0013_content_core
Revises: 0012_session_sync_fields
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013_content_core"
down_revision: str | None = "0012_session_sync_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def common_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid()),
    ]


def lifecycle_columns() -> list[sa.Column]:
    return [
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    ]


def task_fk(name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["task_id", "workspace_id"],
        ["tasks.id", "tasks.workspace_id"],
        name=name,
        ondelete="RESTRICT",
    )


def upgrade() -> None:
    op.create_table(
        "notes",
        *common_columns(),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("markdown_body", sa.Text(), nullable=False, server_default=""),
        *lifecycle_columns(),
        task_fk("fk_note_task_workspace"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_note_workspace"),
    )
    op.create_index(
        "ix_notes_workspace_space_updated", "notes", ["workspace_id", "space_id", "updated_at"]
    )
    op.create_table(
        "resources",
        *common_columns(),
        sa.Column("resource_type", sa.String(16), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("pdf_filename", sa.String(255)),
        sa.Column("page_count", sa.Integer()),
        sa.Column("sha256", sa.String(64)),
        sa.Column("page_index", postgresql.JSONB(), nullable=False, server_default="[]"),
        *lifecycle_columns(),
        task_fk("fk_resource_task_workspace"),
        sa.CheckConstraint("resource_type IN ('link','pdf_index')", name="ck_resources_type"),
        sa.CheckConstraint(
            "page_count IS NULL OR page_count BETWEEN 1 AND 100000", name="ck_resources_pages"
        ),
        sa.CheckConstraint("jsonb_typeof(page_index) = 'array'", name="ck_resources_page_index"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_resource_workspace"),
    )
    op.create_index(
        "ix_resources_workspace_space_updated",
        "resources",
        ["workspace_id", "space_id", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_resources_workspace_space_updated", table_name="resources")
    op.drop_table("resources")
    op.drop_index("ix_notes_workspace_space_updated", table_name="notes")
    op.drop_table("notes")
