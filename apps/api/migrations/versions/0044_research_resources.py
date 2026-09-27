"""Unify private papers with resources while preserving the legacy tables.

Revision ID: 0044_research_resources
Revises: 0043_workspace_invitation_email
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0044_research_resources"
down_revision: str = "0043_workspace_invitation_email"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_COLUMNS = (
    "research_owner_id",
    "legacy_paper_id",
    "csl",
    "doi",
    "arxiv_id",
    "pmid",
    "citation_key",
    "tags",
    "zotero_library_id",
    "zotero_item_key",
    "zotero_version",
    "file_locator",
    "reading_status",
    "read_at",
)
CHECKS = {
    "ck_resources_research_owner": (
        "resource_type IN ('link','pdf_index') OR research_owner_id IS NOT NULL"
    ),
    "ck_resources_csl": "jsonb_typeof(csl) = 'object'",
    "ck_resources_tags": "jsonb_typeof(tags) = 'array'",
    "ck_resources_file_locator": "file_locator IS NULL OR jsonb_typeof(file_locator) = 'object'",
    "ck_resources_reading_status": (
        "reading_status IN ('unread','skimmed','reading','close_read','archived')"
    ),
    "ck_resources_zotero_version": "zotero_version IS NULL OR zotero_version >= 0",
}


def upgrade() -> None:
    for column in [
        sa.Column("research_owner_id", sa.Uuid(), nullable=True),
        sa.Column("legacy_paper_id", sa.Uuid(), nullable=True),
        sa.Column("csl", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("doi", sa.String(255), nullable=True),
        sa.Column("arxiv_id", sa.String(80), nullable=True),
        sa.Column("pmid", sa.String(20), nullable=True),
        sa.Column("citation_key", sa.String(160), nullable=True),
        sa.Column(
            "tags", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("zotero_library_id", sa.String(80), nullable=True),
        sa.Column("zotero_item_key", sa.String(80), nullable=True),
        sa.Column("zotero_version", sa.BigInteger(), nullable=True),
        sa.Column("file_locator", postgresql.JSONB(), nullable=True),
        sa.Column("reading_status", sa.String(16), nullable=False, server_default="unread"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    ]:
        op.add_column("resources", column)
    op.create_foreign_key(
        "fk_resources_research_owner_id_users",
        "resources",
        "users",
        ["research_owner_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_resources_legacy_paper_id_paper_records",
        "resources",
        "paper_records",
        ["legacy_paper_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint("uq_resource_legacy_paper", "resources", ["legacy_paper_id"])
    op.create_unique_constraint(
        "uq_resource_research_scope",
        "resources",
        ["id", "workspace_id", "space_id", "research_owner_id"],
    )
    op.drop_constraint("ck_resources_type", "resources", type_="check")
    op.create_check_constraint(
        "ck_resources_type",
        "resources",
        "resource_type IN ('link','pdf_index','paper','book','preprint','web')",
    )
    for name, check in CHECKS.items():
        op.create_check_constraint(name, "resources", check)
    for identifier in ("doi", "arxiv_id", "pmid"):
        op.create_index(
            f"uq_resources_owner_{identifier}",
            "resources",
            ["space_id", "research_owner_id", identifier],
            unique=True,
            postgresql_where=sa.text(
                f"{identifier} IS NOT NULL AND research_owner_id IS NOT NULL AND deleted_at IS NULL"
            ),
        )
    op.execute(
        sa.text("""
        INSERT INTO resources (
            id, workspace_id, space_id, research_owner_id, legacy_paper_id,
            resource_type, title, citation_key, source_url, page_index,
            version, created_by, updated_by, created_at, updated_at, deleted_at
        )
        SELECT gen_random_uuid(), workspace_id, space_id, user_id, id,
            'paper', title, citation_key, source_url, '[]'::jsonb,
            version, created_by, updated_by, created_at, updated_at, deleted_at
        FROM paper_records
    """)
    )
    op.add_column("research_claims", sa.Column("resource_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_research_claim_resource_scope",
        "research_claims",
        "resources",
        ["resource_id", "workspace_id", "space_id", "user_id"],
        ["id", "workspace_id", "space_id", "research_owner_id"],
        ondelete="CASCADE",
    )
    op.execute(
        sa.text("""
        UPDATE research_claims AS c SET resource_id = r.id
        FROM resources AS r WHERE r.legacy_paper_id = c.paper_id
    """)
    )


def downgrade() -> None:
    # Derived, unchanged paper copies can be rebuilt. Refuse to discard new research data.
    changed = op.get_bind().scalar(
        sa.text("""
        SELECT EXISTS (
            SELECT 1 FROM resources r LEFT JOIN paper_records p ON p.id = r.legacy_paper_id
            WHERE r.research_owner_id IS NOT NULL AND (
                p.id IS NULL OR r.resource_type <> 'paper'
                OR r.title IS DISTINCT FROM p.title OR r.source_url IS DISTINCT FROM p.source_url
                OR r.citation_key IS DISTINCT FROM p.citation_key OR r.version <> p.version
                OR r.workspace_id <> p.workspace_id OR r.space_id <> p.space_id
                OR r.research_owner_id <> p.user_id
                OR r.deleted_at IS DISTINCT FROM p.deleted_at
                OR r.csl <> '{}'::jsonb OR r.tags <> '[]'::jsonb
                OR r.doi IS NOT NULL OR r.arxiv_id IS NOT NULL OR r.pmid IS NOT NULL
                OR r.zotero_library_id IS NOT NULL OR r.zotero_item_key IS NOT NULL
                OR r.zotero_version IS NOT NULL OR r.file_locator IS NOT NULL
                OR r.reading_status <> 'unread' OR r.read_at IS NOT NULL
            )
        )
    """)
    )
    if changed:
        raise RuntimeError("Private research data must be preserved before downgrade.")
    op.drop_constraint("fk_research_claim_resource_scope", "research_claims", type_="foreignkey")
    op.drop_column("research_claims", "resource_id")
    op.execute(sa.text("DELETE FROM resources WHERE research_owner_id IS NOT NULL"))
    for identifier in ("doi", "arxiv_id", "pmid"):
        op.drop_index(f"uq_resources_owner_{identifier}", table_name="resources")
    for name in CHECKS:
        op.drop_constraint(name, "resources", type_="check")
    op.drop_constraint("ck_resources_type", "resources", type_="check")
    op.create_check_constraint(
        "ck_resources_type", "resources", "resource_type IN ('link','pdf_index')"
    )
    op.drop_constraint("uq_resource_research_scope", "resources", type_="unique")
    op.drop_constraint("uq_resource_legacy_paper", "resources", type_="unique")
    op.drop_constraint(
        "fk_resources_legacy_paper_id_paper_records", "resources", type_="foreignkey"
    )
    op.drop_constraint("fk_resources_research_owner_id_users", "resources", type_="foreignkey")
    for column in reversed(NEW_COLUMNS):
        op.drop_column("resources", column)
