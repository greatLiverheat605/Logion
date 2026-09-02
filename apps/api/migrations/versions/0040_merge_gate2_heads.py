"""Merge the official-template and Workbench migration branches.

Revision ID: 0040_merge_gate2_heads
Revises: 0036_official_template_catalog, 0039_workbench_foundation
"""

from collections.abc import Sequence

revision: str = "0040_merge_gate2_heads"
down_revision: tuple[str, str] = (
    "0036_official_template_catalog",
    "0039_workbench_foundation",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
