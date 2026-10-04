"""Private expiring server-side long-text form drafts."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0058_form_drafts"
down_revision = "0057_session_persistence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "form_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("form_kind", sa.String(40), nullable=False),
        sa.Column("target_key", sa.Uuid(), nullable=False),
        sa.Column("fields", postgresql.JSONB(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_form_draft_space",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id", "space_id", "form_kind", "target_key", name="uq_form_draft_slot"
        ),
        sa.CheckConstraint("version >= 1", name="ck_form_draft_version"),
        sa.CheckConstraint(
            "jsonb_typeof(fields) = 'object' AND octet_length(fields::text) <= 4194304",
            name="ck_form_draft_fields",
        ),
    )
    op.create_index("ix_form_drafts_expiry", "form_drafts", ["expires_at"])


def downgrade() -> None:
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM form_drafts)")):
        raise RuntimeError("Preserve server form drafts; use a compatible application rollback")
    op.drop_index("ix_form_drafts_expiry", table_name="form_drafts")
    op.drop_table("form_drafts")
