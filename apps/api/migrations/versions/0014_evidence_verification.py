"""Add evidence and human verification records.

Revision ID: 0014_evidence_verification
Revises: 0013_content_core
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014_evidence_verification"
down_revision: str | None = "0013_content_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "evidence_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_type", sa.String(16), nullable=False),
        sa.Column("note_id", sa.Uuid()),
        sa.Column("resource_id", sa.Uuid()),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("external_url", sa.Text()),
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
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_evidence_task_workspace",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_evidence_note_workspace",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["resource_id", "workspace_id"],
            ["resources.id", "resources.workspace_id"],
            name="fk_evidence_resource_workspace",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "evidence_type IN ('text','link','note','resource')", name="ck_evidence_type"
        ),
        sa.CheckConstraint(
            "(evidence_type = 'text' AND note_id IS NULL AND resource_id IS NULL "
            "AND external_url IS NULL AND length(summary) > 0) OR "
            "(evidence_type = 'link' AND note_id IS NULL AND resource_id IS NULL "
            "AND external_url IS NOT NULL) OR "
            "(evidence_type = 'note' AND note_id IS NOT NULL AND resource_id IS NULL "
            "AND external_url IS NULL) OR "
            "(evidence_type = 'resource' AND note_id IS NULL AND resource_id IS NOT NULL "
            "AND external_url IS NULL)",
            name="ck_evidence_shape",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_evidence_workspace"),
    )
    op.create_index("ix_evidence_task_created", "evidence_items", ["task_id", "created_at"])
    op.create_table(
        "verification_records",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("verdict", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("reviewer_notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["evidence_id", "workspace_id"],
            ["evidence_items.id", "evidence_items.workspace_id"],
            name="fk_verification_evidence_workspace",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_verification_task_workspace",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "verdict IN ('pending','passed','failed','needs_revision')",
            name="ck_verification_verdict",
        ),
        sa.CheckConstraint(
            "(verdict = 'pending' AND decided_by IS NULL AND decided_at IS NULL) OR "
            "(verdict <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)",
            name="ck_verification_decision_shape",
        ),
        sa.UniqueConstraint("evidence_id", name="uq_verification_evidence"),
        sa.UniqueConstraint("id", "workspace_id", name="uq_verification_workspace"),
    )
    op.create_index("ix_verification_task_verdict", "verification_records", ["task_id", "verdict"])


def downgrade() -> None:
    op.drop_index("ix_verification_task_verdict", table_name="verification_records")
    op.drop_table("verification_records")
    op.drop_index("ix_evidence_task_created", table_name="evidence_items")
    op.drop_table("evidence_items")
