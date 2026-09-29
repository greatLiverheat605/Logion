"""agent_inbox

Revision ID: 0056_agent_inbox
Revises: 0055_weekly_reviews
Create Date: 2026-09-29 18:20:56.051943
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0056_agent_inbox"
down_revision: str | None = "0055_weekly_reviews"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("token_digest", sa.String(length=64), nullable=False),
        sa.Column("scopes", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "jsonb_typeof(scopes) = 'array' AND jsonb_array_length(scopes) BETWEEN 1 AND "
            "2 AND scopes <@ jsonb_build_array('read','inbox:write')",
            name="ck_agent_token_scopes",
        ),
        sa.CheckConstraint("token_digest ~ '^[0-9a-f]{64}$'", name="ck_agent_token_digest"),
        sa.CheckConstraint("expires_at > created_at", name="ck_agent_token_expiry"),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_agent_token_space",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "id", "user_id", "workspace_id", "space_id", name="uq_agent_token_scope"
        ),
        sa.UniqueConstraint("token_digest"),
    )
    op.create_index(
        "ix_agent_tokens_owner", "agent_tokens", ["user_id", "created_at"], unique=False
    )
    op.create_table(
        "agent_inbox_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("submission_key", sa.String(length=128), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("payload_digest", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="pending", nullable=False),
        sa.Column("version", sa.BigInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "accepted_payload",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "receipt", postgresql.JSONB(none_as_null=True, astext_type=sa.Text()), nullable=True
        ),
        sa.Column("decision_digest", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL AND decision_digest IS NULL AND "
            "receipt IS NULL AND accepted_payload IS NULL) OR (status = 'accepted' AND "
            "decided_at IS NOT NULL AND decision_digest IS NOT NULL AND receipt IS NOT "
            "NULL AND accepted_payload IS NOT NULL) OR (status = 'discarded' AND "
            "decided_at IS NOT NULL AND decision_digest IS NOT NULL AND receipt IS NULL "
            "AND accepted_payload IS NULL)",
            name="ck_agent_inbox_decision",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072",
            name="ck_agent_inbox_payload",
        ),
        sa.CheckConstraint(
            "kind IN ('source','report','summary','edge')", name="ck_agent_inbox_kind"
        ),
        sa.CheckConstraint("payload_digest ~ '^[0-9a-f]{64}$'", name="ck_agent_inbox_digest"),
        sa.CheckConstraint(
            "status IN ('pending','accepted','discarded')", name="ck_agent_inbox_status"
        ),
        sa.ForeignKeyConstraint(
            ["token_id", "user_id", "workspace_id", "space_id"],
            [
                "agent_tokens.id",
                "agent_tokens.user_id",
                "agent_tokens.workspace_id",
                "agent_tokens.space_id",
            ],
            name="fk_agent_inbox_token_scope",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_agent_inbox_scope"
        ),
        sa.UniqueConstraint("token_id", "submission_key", name="uq_agent_inbox_submission"),
    )
    op.create_index(
        "ix_agent_inbox_owner_status",
        "agent_inbox_items",
        ["user_id", "space_id", "status", "id"],
        unique=False,
    )
    op.add_column("notes", sa.Column("agent_inbox_item_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint("uq_note_agent_inbox", "notes", ["agent_inbox_item_id"])
    op.create_foreign_key(
        "fk_note_agent_inbox",
        "notes",
        "agent_inbox_items",
        ["agent_inbox_item_id", "workspace_id", "space_id", "research_owner_id"],
        ["id", "workspace_id", "space_id", "user_id"],
        ondelete="RESTRICT",
    )

    op.drop_constraint("ck_note_research_kind", "notes", type_="check")
    op.create_check_constraint(
        "ck_note_research_kind",
        "notes",
        "(note_kind IS NULL AND resource_id IS NULL AND research_owner_id IS NULL AND "
        "agent_inbox_item_id IS NULL) OR (note_kind IS NOT NULL AND note_kind = "
        "'close_reading' AND resource_id IS NOT NULL AND research_owner_id IS NOT "
        "NULL AND task_id IS NULL AND agent_inbox_item_id IS NULL) OR (note_kind IS "
        "NULL AND resource_id IS NULL AND research_owner_id IS NOT NULL AND task_id "
        "IS NULL AND agent_inbox_item_id IS NOT NULL)",
    )


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM agent_tokens) OR EXISTS (SELECT 1 FROM "
            "agent_inbox_items) OR EXISTS (SELECT 1 FROM notes WHERE agent_inbox_item_id "
            "IS NOT NULL)"
        )
    ):
        raise RuntimeError(
            "Preserve agent tokens, inbox items and accepted notes before downgrade."
        )
    op.drop_constraint("ck_note_research_kind", "notes", type_="check")
    op.create_check_constraint(
        "ck_note_research_kind",
        "notes",
        "(note_kind IS NULL AND resource_id IS NULL AND research_owner_id IS NULL) OR "
        "(note_kind IS NOT NULL AND note_kind = 'close_reading' AND resource_id IS "
        "NOT NULL AND research_owner_id IS NOT NULL AND task_id IS NULL)",
    )
    op.drop_constraint("fk_note_agent_inbox", "notes", type_="foreignkey")
    op.drop_constraint("uq_note_agent_inbox", "notes", type_="unique")
    op.drop_column("notes", "agent_inbox_item_id")
    op.drop_index("ix_agent_inbox_owner_status", table_name="agent_inbox_items")
    op.drop_table("agent_inbox_items")
    op.drop_index("ix_agent_tokens_owner", table_name="agent_tokens")
    op.drop_table("agent_tokens")
