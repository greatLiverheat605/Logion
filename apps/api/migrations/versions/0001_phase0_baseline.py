"""Create the Phase 0 migration baseline.

Revision ID: 0001_phase0
Revises: None
Create Date: 2026-07-19
"""

from collections.abc import Sequence

revision: str = "0001_phase0"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Reserve a stable migration root before domain tables exist."""


def downgrade() -> None:
    """The empty baseline is reversible."""
