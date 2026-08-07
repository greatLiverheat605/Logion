"""Persist the fail-closed Local Worker lease protocol.

Revision ID: 0038_local_worker_protocol
Revises: 0037_knowledge_acceptance
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0038_local_worker_protocol"
down_revision: str | None = "0037_knowledge_acceptance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_local_worker_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "state", sa.String(length=16), nullable=False, server_default=sa.text("'queued'")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_local_worker_job_space_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_local_worker_job_actor",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "state IN ('queued','running','uploaded','completed','failed')",
            name="ck_local_worker_job_state",
        ),
        sa.CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_job_input_hash",
        ),
        sa.UniqueConstraint("id", "workspace_id", name="uq_local_worker_job_workspace"),
    )
    op.create_index(
        "ix_local_worker_jobs_owner_state",
        "knowledge_local_worker_jobs",
        ["created_by", "state", "updated_at", "id"],
    )
    op.create_index(
        "ix_local_worker_jobs_scope",
        "knowledge_local_worker_jobs",
        ["workspace_id", "space_id", "state", "updated_at", "id"],
    )

    op.create_table(
        "knowledge_local_worker_leases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("token_sha256", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "state", sa.String(length=16), nullable=False, server_default=sa.text("'active'")
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_lease_job_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_local_worker_lease_space_scope",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "state IN ('active','revoked','expired','completed')",
            name="ck_local_worker_lease_state",
        ),
        sa.CheckConstraint(
            "token_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_lease_token_hash",
        ),
        sa.CheckConstraint("expires_at > issued_at", name="ck_local_worker_lease_expiry"),
        sa.UniqueConstraint("id", "job_id", "workspace_id", name="uq_local_worker_lease_job_scope"),
    )
    op.create_index(
        "ix_local_worker_leases_job_state",
        "knowledge_local_worker_leases",
        ["job_id", "state", "expires_at", "id"],
    )

    op.create_table(
        "knowledge_local_worker_checkpoints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column("stage", sa.String(length=16), nullable=False),
        sa.Column("output_sha256", sa.String(length=64)),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_checkpoint_job_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["lease_id", "job_id", "workspace_id"],
            [
                "knowledge_local_worker_leases.id",
                "knowledge_local_worker_leases.job_id",
                "knowledge_local_worker_leases.workspace_id",
            ],
            name="fk_local_worker_checkpoint_lease_scope",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "stage IN ('claimed','running','uploaded')",
            name="ck_local_worker_checkpoint_stage",
        ),
        sa.CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_checkpoint_input_hash",
        ),
        sa.CheckConstraint(
            "output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_checkpoint_output_hash",
        ),
        sa.CheckConstraint(
            "(stage = 'uploaded' AND output_sha256 IS NOT NULL) "
            "OR (stage <> 'uploaded' AND output_sha256 IS NULL)",
            name="ck_local_worker_checkpoint_uploaded_hash",
        ),
        sa.UniqueConstraint("job_id", name="uq_local_worker_checkpoint_job"),
    )
    op.create_index(
        "ix_local_worker_checkpoints_recovery",
        "knowledge_local_worker_checkpoints",
        ["workspace_id", "space_id", "updated_at", "job_id"],
    )

    op.create_table(
        "knowledge_local_worker_result_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("lease_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("input_sha256", sa.String(length=64), nullable=False),
        sa.Column("output_sha256", sa.String(length=64), nullable=False),
        sa.Column("payload_sha256", sa.String(length=64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_receipt_job_scope",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["lease_id", "job_id", "workspace_id"],
            [
                "knowledge_local_worker_leases.id",
                "knowledge_local_worker_leases.job_id",
                "knowledge_local_worker_leases.workspace_id",
            ],
            name="fk_local_worker_receipt_lease_scope",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_input_hash",
        ),
        sa.CheckConstraint(
            "output_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_output_hash",
        ),
        sa.CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_payload_hash",
        ),
        sa.CheckConstraint(
            "char_length(idempotency_key) BETWEEN 1 AND 128 "
            "AND octet_length(idempotency_key) <= 128 "
            "AND idempotency_key ~ '^[!-~]+$'",
            name="ck_local_worker_receipt_idempotency_key",
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "job_id",
            "idempotency_key",
            name="uq_local_worker_receipt_idempotency",
        ),
    )
    op.create_index(
        "ix_local_worker_receipts_job",
        "knowledge_local_worker_result_receipts",
        ["workspace_id", "space_id", "job_id", "accepted_at"],
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError(
            "V20-11 Local Worker downgrade is disabled because table emptiness cannot be proven"
        )
    connection = op.get_bind()
    table_checks = (
        (
            "knowledge_local_worker_result_receipts",
            sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_local_worker_result_receipts)"),
        ),
        (
            "knowledge_local_worker_checkpoints",
            sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_local_worker_checkpoints)"),
        ),
        (
            "knowledge_local_worker_leases",
            sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_local_worker_leases)"),
        ),
        (
            "knowledge_local_worker_jobs",
            sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_local_worker_jobs)"),
        ),
    )
    for table_name, statement in table_checks:
        if connection.execute(statement).scalar():
            raise RuntimeError(f"V20-11 downgrade stopped: {table_name} is not empty")
    op.drop_index(
        "ix_local_worker_receipts_job", table_name="knowledge_local_worker_result_receipts"
    )
    op.drop_table("knowledge_local_worker_result_receipts")
    op.drop_index(
        "ix_local_worker_checkpoints_recovery", table_name="knowledge_local_worker_checkpoints"
    )
    op.drop_table("knowledge_local_worker_checkpoints")
    op.drop_index("ix_local_worker_leases_job_state", table_name="knowledge_local_worker_leases")
    op.drop_table("knowledge_local_worker_leases")
    op.drop_index("ix_local_worker_jobs_scope", table_name="knowledge_local_worker_jobs")
    op.drop_index("ix_local_worker_jobs_owner_state", table_name="knowledge_local_worker_jobs")
    op.drop_table("knowledge_local_worker_jobs")
