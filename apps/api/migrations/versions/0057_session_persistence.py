"""Preserve the browser persistence choice across MFA and refresh."""

import sqlalchemy as sa
from alembic import op

revision = "0057_session_persistence"
down_revision = "0056_agent_inbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("auth_sessions", "mfa_challenges"):
        op.add_column(
            table,
            sa.Column("keep_signed_in", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM auth_sessions WHERE NOT keep_signed_in "
            "AND revoked_at IS NULL AND refresh_expires_at > now()) OR EXISTS "
            "(SELECT 1 FROM mfa_challenges WHERE NOT keep_signed_in "
            "AND used_at IS NULL AND expires_at > now())"
        )
    ):
        raise RuntimeError(
            "Revoke or expire nonpersistent sessions and challenges before downgrade"
        )
    for table in ("mfa_challenges", "auth_sessions"):
        op.drop_column(table, "keep_signed_in")
