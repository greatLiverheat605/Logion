"""Add fail-closed AI knowledge candidates and acceptance receipts.

Revision ID: 0037_knowledge_acceptance
Revises: 0036_knowledge_space
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0037_knowledge_acceptance"
down_revision: str | None = "0036_knowledge_space"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_output_draft_candidates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("source_excerpt_id", sa.Uuid(), nullable=False),
        sa.Column("target_type", sa.String(length=32), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("relationship_kind", sa.String(length=32), nullable=False),
        sa.Column("relation_note", sa.Text()),
        sa.Column("target_version", sa.BigInteger(), nullable=False),
        sa.Column("excerpt_version", sa.BigInteger(), nullable=False),
        sa.Column("excerpt_sha256", sa.String(length=64), nullable=False),
        sa.Column("source_version_key", sa.String(length=512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["draft_id", "workspace_id"],
            ["ai_output_drafts.id", "ai_output_drafts.workspace_id"],
            name="fk_ai_draft_candidate_draft_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["source_excerpt_id", "workspace_id", "space_id"],
            ["source_excerpts.id", "source_excerpts.workspace_id", "source_excerpts.space_id"],
            name="fk_ai_draft_candidate_excerpt_scope",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "target_type IN ('topic','quiz_item','research_claim','note')",
            name="ck_ai_draft_candidate_target_type",
        ),
        sa.CheckConstraint(
            "relationship_kind IN "
            "('source','definition','support','contradiction','example','derivation')",
            name="ck_ai_draft_candidate_relationship",
        ),
        sa.CheckConstraint(
            "target_version >= 1",
            name="ck_ai_draft_candidate_target_version",
        ),
        sa.CheckConstraint(
            "excerpt_version >= 1",
            name="ck_ai_draft_candidate_excerpt_version",
        ),
        sa.CheckConstraint(
            "source_version_key IS NOT NULL "
            "AND char_length(btrim(source_version_key)) BETWEEN 1 AND 512",
            name="ck_ai_draft_candidate_source_version_key",
        ),
        sa.CheckConstraint(
            "excerpt_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_ai_draft_candidate_excerpt_hash",
        ),
        sa.CheckConstraint(
            "relation_note IS NULL OR (char_length(relation_note) <= 2000 "
            "AND octet_length(relation_note) <= 8192)",
            name="ck_ai_draft_candidate_note_bounds",
        ),
        sa.UniqueConstraint(
            "id",
            "workspace_id",
            name="uq_ai_draft_candidate_workspace",
        ),
    )
    op.create_index(
        "ix_ai_draft_candidate_draft",
        "ai_output_draft_candidates",
        ["workspace_id", "space_id", "draft_id", "id"],
    )

    op.create_table(
        "knowledge_acceptance_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("accepted_by", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'applied'"),
        ),
        sa.Column(
            "created_object_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.ForeignKeyConstraint(
            ["draft_id", "workspace_id"],
            ["ai_output_drafts.id", "ai_output_drafts.workspace_id"],
            name="fk_knowledge_acceptance_receipt_draft_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_knowledge_acceptance_receipt_space_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_by"],
            ["users.id"],
            name="fk_knowledge_acceptance_receipt_actor",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status = 'applied'",
            name="ck_knowledge_acceptance_receipt_status",
        ),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_knowledge_acceptance_receipt_payload_hash",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(created_object_ids) = 'array'",
            name="ck_knowledge_acceptance_receipt_object_ids",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "accepted_by",
            "idempotency_key",
            name="uq_knowledge_acceptance_receipt_idempotency",
        ),
    )
    op.create_index(
        "ix_knowledge_acceptance_receipt_draft",
        "knowledge_acceptance_receipts",
        ["workspace_id", "space_id", "draft_id", "created_at"],
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError(
            "V20-09 offline downgrade is disabled because table emptiness cannot be proven"
        )
    connection = op.get_bind()
    table_checks = (
        (
            "knowledge_acceptance_receipts",
            sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_acceptance_receipts)"),
        ),
        (
            "ai_output_draft_candidates",
            sa.text("SELECT EXISTS (SELECT 1 FROM ai_output_draft_candidates)"),
        ),
    )
    for table_name, statement in table_checks:
        populated = connection.execute(statement).scalar()
        if populated:
            raise RuntimeError(f"V20-09 downgrade stopped: {table_name} is not empty")

    op.drop_index(
        "ix_knowledge_acceptance_receipt_draft",
        table_name="knowledge_acceptance_receipts",
    )
    op.drop_table("knowledge_acceptance_receipts")
    op.drop_index(
        "ix_ai_draft_candidate_draft",
        table_name="ai_output_draft_candidates",
    )
    op.drop_table("ai_output_draft_candidates")
