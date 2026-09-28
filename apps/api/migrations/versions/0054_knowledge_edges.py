"""Private typed links with persistent rejection tombstones."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0054_knowledge_edges"
down_revision: str | None = "0053_question_tree"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_research_idea_scope", "research_ideas", ["id", "workspace_id", "space_id", "user_id"]
    )
    op.create_table(
        "knowledge_edges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("from_resource_id", sa.Uuid(), nullable=True),
        sa.Column("from_claim_id", sa.Uuid(), nullable=True),
        sa.Column("from_idea_id", sa.Uuid(), nullable=True),
        sa.Column("to_resource_id", sa.Uuid(), nullable=True),
        sa.Column("to_topic_id", sa.Uuid(), nullable=True),
        sa.Column("to_question_id", sa.Uuid(), nullable=True),
        sa.Column(
            "from_type",
            sa.String(length=16),
            sa.Computed(
                "CASE WHEN from_resource_id IS NOT NULL THEN 'resource' "
                "WHEN from_claim_id IS NOT NULL THEN 'claim' ELSE 'idea' END",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "from_id",
            sa.Uuid(),
            sa.Computed("COALESCE(from_resource_id,from_claim_id,from_idea_id)", persisted=True),
            nullable=False,
        ),
        sa.Column(
            "to_type",
            sa.String(length=16),
            sa.Computed(
                "CASE WHEN to_resource_id IS NOT NULL THEN 'resource' "
                "WHEN to_topic_id IS NOT NULL THEN 'topic' ELSE 'question' END",
                persisted=True,
            ),
            nullable=False,
        ),
        sa.Column(
            "to_id",
            sa.Uuid(),
            sa.Computed("COALESCE(to_resource_id,to_topic_id,to_question_id)", persisted=True),
            nullable=False,
        ),
        sa.Column("relation", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("origin", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence_excerpt_id", sa.Uuid(), nullable=True),
        sa.Column("ai_run_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(from_type='resource' AND to_type='question' AND relation='addresses') OR "
            "(from_type='resource' AND to_type='topic' AND relation IN ('defines','uses')) OR "
            "(from_type='resource' AND to_type='resource' AND "
            "relation IN ('extends','contradicts','supersedes')) OR "
            "(from_type='claim' AND to_type='question' "
            "AND relation IN ('supports','challenges')) OR "
            "(from_type='idea' AND to_type='resource' AND relation='inspired_by')",
            name="ck_knowledge_edge_relation",
        ),
        sa.CheckConstraint(
            "(origin='user' AND ai_run_id IS NULL AND status<>'suggested') OR "
            "(origin='ai' AND ai_run_id IS NOT NULL AND from_type<>'idea' AND to_type<>'idea')",
            name="ck_edge_origin",
        ),
        sa.CheckConstraint("status IN ('suggested','confirmed','rejected')", name="ck_edge_status"),
        sa.CheckConstraint(
            "version>=1 AND char_length(reason)<=1000 AND "
            "(origin<>'ai' OR char_length(btrim(reason))>0)",
            name="ck_edge_bounds",
        ),
        sa.CheckConstraint("from_type <> to_type OR from_id <> to_id", name="ck_edge_not_self"),
        sa.CheckConstraint(
            "num_nonnulls(from_resource_id,from_claim_id,from_idea_id)=1 AND "
            "num_nonnulls(to_resource_id,to_topic_id,to_question_id)=1",
            name="ck_knowledge_edge_endpoints",
        ),
        sa.ForeignKeyConstraint(
            ["ai_run_id", "workspace_id"],
            ["ai_runs.id", "ai_runs.workspace_id"],
            name="fk_knowledge_edge_ai_run",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["evidence_excerpt_id", "workspace_id", "space_id"],
            ["source_excerpts.id", "source_excerpts.workspace_id", "source_excerpts.space_id"],
            name="fk_edge_evidence_excerpt_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["from_claim_id", "workspace_id", "space_id", "user_id"],
            [
                "research_claims.id",
                "research_claims.workspace_id",
                "research_claims.space_id",
                "research_claims.user_id",
            ],
            name="fk_edge_from_claim_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["from_idea_id", "workspace_id", "space_id", "user_id"],
            [
                "research_ideas.id",
                "research_ideas.workspace_id",
                "research_ideas.space_id",
                "research_ideas.user_id",
            ],
            name="fk_edge_from_idea_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["from_resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            name="fk_edge_from_resource_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_knowledge_edge_space",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["to_question_id", "workspace_id", "space_id", "user_id"],
            [
                "research_questions.id",
                "research_questions.workspace_id",
                "research_questions.space_id",
                "research_questions.user_id",
            ],
            name="fk_edge_to_question_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["to_resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            name="fk_edge_to_resource_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["to_topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_edge_to_topic_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "space_id",
            "user_id",
            "from_type",
            "from_id",
            "to_type",
            "to_id",
            "relation",
            name="uq_knowledge_edge_identity",
        ),
    )
    op.create_index(
        "ix_knowledge_edge_from",
        "knowledge_edges",
        ["workspace_id", "space_id", "user_id", "from_type", "from_id"],
        unique=False,
    )
    op.create_index(
        "ix_knowledge_edge_owner",
        "knowledge_edges",
        ["workspace_id", "space_id", "user_id", "id"],
        unique=False,
    )
    op.create_index(
        "ix_knowledge_edge_to",
        "knowledge_edges",
        ["workspace_id", "space_id", "user_id", "to_type", "to_id"],
        unique=False,
    )


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_edges)")):
        raise RuntimeError("Preserve knowledge links before downgrade.")
    op.drop_index("ix_knowledge_edge_to", table_name="knowledge_edges")
    op.drop_index("ix_knowledge_edge_owner", table_name="knowledge_edges")
    op.drop_index("ix_knowledge_edge_from", table_name="knowledge_edges")
    op.drop_table("knowledge_edges")
    op.drop_constraint("uq_research_idea_scope", "research_ideas", type_="unique")
