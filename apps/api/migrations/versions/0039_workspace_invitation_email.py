"""Queue encrypted Workspace invitation emails.

Revision ID: 0039_workspace_invitation_email
Revises: 0038_local_worker_protocol
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039_workspace_invitation_email"
down_revision: str | None = "0038_local_worker_protocol"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_email_outbox_purpose", "email_outbox", type_="check")
    op.add_column(
        "email_outbox",
        sa.Column("workspace_invitation_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_email_outbox_workspace_invitation",
        "email_outbox",
        "workspace_invitations",
        ["workspace_invitation_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_email_outbox_workspace_invitation_id",
        "email_outbox",
        ["workspace_invitation_id"],
    )
    op.create_check_constraint(
        "ck_email_outbox_purpose",
        "email_outbox",
        "purpose IN ('email_verification', 'password_recovery', "
        "'security_notification', 'workspace_invitation')",
    )
    op.create_check_constraint(
        "ck_email_outbox_workspace_invitation",
        "email_outbox",
        "(purpose = 'workspace_invitation' AND workspace_invitation_id IS NOT NULL "
        "AND action_token_id IS NULL) OR "
        "(purpose <> 'workspace_invitation' AND workspace_invitation_id IS NULL)",
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError(
            "Workspace invitation email downgrade requires an online emptiness check"
        )
    connection = op.get_bind()
    if connection.execute(
        sa.text("SELECT EXISTS (SELECT 1 FROM email_outbox WHERE purpose = 'workspace_invitation')")
    ).scalar():
        raise RuntimeError(
            "Workspace invitation email downgrade stopped: delivery records still exist"
        )

    op.drop_constraint(
        "ck_email_outbox_workspace_invitation",
        "email_outbox",
        type_="check",
    )
    op.drop_constraint("ck_email_outbox_purpose", "email_outbox", type_="check")
    op.drop_index(
        "ix_email_outbox_workspace_invitation_id",
        table_name="email_outbox",
    )
    op.drop_constraint(
        "fk_email_outbox_workspace_invitation",
        "email_outbox",
        type_="foreignkey",
    )
    op.drop_column("email_outbox", "workspace_invitation_id")
    op.create_check_constraint(
        "ck_email_outbox_purpose",
        "email_outbox",
        "purpose IN ('email_verification', 'password_recovery', 'security_notification')",
    )
