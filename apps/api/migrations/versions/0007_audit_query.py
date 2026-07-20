"""Add keyset indexes for scoped audit queries.

Revision ID: 0007_audit_query
Revises: 0006_invitation
Create Date: 2026-07-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_audit_query"
down_revision: str | None = "0006_invitation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_audit_events_actor_time_id",
        "audit_events",
        ["actor_id", "occurred_at", "id"],
    )
    op.create_index(
        "ix_audit_events_workspace_time_id",
        "audit_events",
        ["workspace_id", "occurred_at", "id"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_workspace_time_id", table_name="audit_events")
    op.drop_index("ix_audit_events_actor_time_id", table_name="audit_events")
