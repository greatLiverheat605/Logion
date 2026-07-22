"""Add durable AI runs, budget reservations, and output drafts.

Revision ID: 0026_ai_runs_drafts
Revises: 0025_ai_routing_budget
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0026_ai_runs_drafts"
down_revision: str | None = "0025_ai_routing_budget"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ai_usage_monthly",
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("period_start", sa.Date(), primary_key=True),
        sa.Column("reserved_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("consumed_tokens", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("reserved_cost_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("consumed_cost_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "reserved_tokens >= 0 AND consumed_tokens >= 0 "
            "AND reserved_cost_minor >= 0 AND consumed_cost_minor >= 0",
            name="ck_ai_usage_nonnegative",
        ),
    )
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "route_id",
            sa.Uuid(),
            sa.ForeignKey("ai_task_routes.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("task_type", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("target_version", sa.BigInteger(), nullable=False),
        sa.Column("selected_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "expected_output_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("input_ciphertext", sa.LargeBinary()),
        sa.Column("input_nonce", sa.LargeBinary(12)),
        sa.Column("input_data_key_ciphertext", sa.LargeBinary()),
        sa.Column("input_data_key_nonce", sa.LargeBinary(12)),
        sa.Column("input_encryption_key_id", sa.String(64)),
        sa.Column("retain_input", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("prompt_version", sa.String(64), nullable=False),
        sa.Column("prompt_hash", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("estimated_input_tokens", sa.Integer(), nullable=False),
        sa.Column("requested_output_tokens", sa.Integer(), nullable=False),
        sa.Column("reserved_tokens", sa.BigInteger(), nullable=False),
        sa.Column("reserved_cost_minor", sa.BigInteger(), nullable=False),
        sa.Column("actual_input_tokens", sa.BigInteger()),
        sa.Column("actual_output_tokens", sa.BigInteger()),
        sa.Column("actual_cost_minor", sa.BigInteger()),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "selected_model_id",
            sa.Uuid(),
            sa.ForeignKey("ai_models.id", ondelete="RESTRICT"),
        ),
        sa.Column(
            "selected_provider_id",
            sa.Uuid(),
            sa.ForeignKey("ai_providers.id", ondelete="RESTRICT"),
        ),
        sa.Column("selected_candidate_position", sa.Integer()),
        sa.Column("error_code", sa.String(64)),
        sa.Column("cancel_requested_at", sa.DateTime(timezone=True)),
        sa.Column(
            "requested_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('queued','running','succeeded','failed','cancelled')",
            name="ck_ai_run_status",
        ),
        sa.CheckConstraint("target_version > 0", name="ck_ai_run_target_version"),
        sa.CheckConstraint(
            "estimated_input_tokens > 0 AND requested_output_tokens > 0 "
            "AND reserved_tokens > 0 AND reserved_cost_minor >= 0",
            name="ck_ai_run_estimates",
        ),
        sa.UniqueConstraint(
            "workspace_id", "requested_by", "idempotency_key", name="uq_ai_run_idempotency"
        ),
    )
    op.create_index("ix_ai_run_workspace_created", "ai_runs", ["workspace_id", "created_at"])
    op.create_index(
        "ix_ai_run_queue",
        "ai_runs",
        ["status", "created_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )
    op.create_table(
        "ai_run_candidates",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "model_id",
            sa.Uuid(),
            sa.ForeignKey("ai_models.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "provider_id",
            sa.Uuid(),
            sa.ForeignKey("ai_providers.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("estimated_cost_minor", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_ai_run_candidate_position"),
        sa.UniqueConstraint("run_id", "position", name="uq_ai_run_candidate_position"),
        sa.UniqueConstraint("run_id", "model_id", name="uq_ai_run_candidate_model"),
    )
    op.create_index(
        "ix_ai_run_candidate_run", "ai_run_candidates", ["workspace_id", "run_id", "position"]
    )
    op.create_table(
        "ai_output_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("ai_runs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("target_type", sa.String(64), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("target_version", sa.BigInteger(), nullable=False),
        sa.Column("structured_output", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("edited_output", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("decided_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("decision_note", sa.String(1000)),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending','accepted','rejected')", name="ck_ai_draft_status"
        ),
    )
    op.create_index(
        "ix_ai_draft_workspace_created", "ai_output_drafts", ["workspace_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_ai_draft_workspace_created", table_name="ai_output_drafts")
    op.drop_table("ai_output_drafts")
    op.drop_index("ix_ai_run_candidate_run", table_name="ai_run_candidates")
    op.drop_table("ai_run_candidates")
    op.drop_index("ix_ai_run_queue", table_name="ai_runs")
    op.drop_index("ix_ai_run_workspace_created", table_name="ai_runs")
    op.drop_table("ai_runs")
    op.drop_table("ai_usage_monthly")
