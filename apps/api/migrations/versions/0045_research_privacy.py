"""Private ideas and durable AI context provenance.

Revision ID: 0045_research_privacy
Revises: 0044_research_resources
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0045_research_privacy"
down_revision: str = "0044_research_resources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "research_ideas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column(
            "updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_research_idea_space_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("status IN ('active','archived')", name="ck_research_idea_status"),
    )
    op.create_index(
        "ix_research_idea_owner", "research_ideas", ["workspace_id", "space_id", "user_id", "id"]
    )
    op.add_column(
        "ai_runs",
        sa.Column(
            "context_entity_types",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_check_constraint(
        "ck_ai_run_context_types", "ai_runs", "jsonb_typeof(context_entity_types) = 'array'"
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM research_ideas) OR EXISTS "
            "(SELECT 1 FROM ai_runs WHERE context_entity_types <> '[]'::jsonb)"
        )
    ):
        raise RuntimeError("Preserve private ideas and research AI provenance before downgrade.")
    op.drop_constraint("ck_ai_run_context_types", "ai_runs", type_="check")
    op.drop_column("ai_runs", "context_entity_types")
    op.drop_index("ix_research_idea_owner", table_name="research_ideas")
    op.drop_table("research_ideas")
