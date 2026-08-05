"""Add the gated knowledge-space evidence foundation.

Revision ID: 0036_knowledge_space
Revises: 0035_add_user_settings
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036_knowledge_space"
down_revision: str | None = "0035_add_user_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PARENT_SCOPE_INDEXES = (
    ("uq_space_workspace", "spaces", ("id", "workspace_id")),
    ("uq_resource_scope", "resources", ("id", "workspace_id", "space_id")),
    ("uq_note_scope", "notes", ("id", "workspace_id", "space_id")),
    ("uq_quiz_item_scope", "quiz_items", ("id", "workspace_id", "space_id")),
    ("uq_ai_output_draft_workspace", "ai_output_drafts", ("id", "workspace_id")),
)

_EXISTING_SCOPE_FOREIGN_KEYS = (
    ("fk_resource_space_scope", "resources"),
    ("fk_note_space_scope", "notes"),
    ("fk_topic_space_scope", "topics"),
    ("fk_quiz_item_space_scope", "quiz_items"),
    ("fk_paper_record_space_scope", "paper_records"),
)

_CITATION_INDEXES = (
    "uq_knowledge_citation_active_note",
    "uq_knowledge_citation_active_research_claim",
    "uq_knowledge_citation_active_quiz_item",
    "uq_knowledge_citation_active_topic",
    "ix_knowledge_citations_active_note",
    "ix_knowledge_citations_active_research_claim",
    "ix_knowledge_citations_active_quiz_item",
    "ix_knowledge_citations_active_topic",
    "ix_knowledge_citations_acceptance_operation",
    "ix_knowledge_citations_active_excerpt",
)

_EXCERPT_INDEXES = (
    "ix_source_excerpts_stale",
    "ix_source_excerpts_active_hash",
    "ix_source_excerpts_active_resource",
)


def _is_offline_mode() -> bool:
    return op.get_context().as_sql


def _assert_existing_scope_integrity() -> None:
    if _is_offline_mode():
        return

    connection = op.get_bind()
    checks = (
        (
            "resources",
            """
            SELECT 1
            FROM resources AS child
            LEFT JOIN spaces AS parent
              ON parent.id = child.space_id
             AND parent.workspace_id = child.workspace_id
            WHERE parent.id IS NULL
            LIMIT 1
            """,
        ),
        (
            "notes",
            """
            SELECT 1
            FROM notes AS child
            LEFT JOIN spaces AS parent
              ON parent.id = child.space_id
             AND parent.workspace_id = child.workspace_id
            WHERE parent.id IS NULL
            LIMIT 1
            """,
        ),
        (
            "topics",
            """
            SELECT 1
            FROM topics AS child
            LEFT JOIN spaces AS parent
              ON parent.id = child.space_id
             AND parent.workspace_id = child.workspace_id
            WHERE parent.id IS NULL
            LIMIT 1
            """,
        ),
        (
            "quiz_items",
            """
            SELECT 1
            FROM quiz_items AS child
            LEFT JOIN spaces AS parent
              ON parent.id = child.space_id
             AND parent.workspace_id = child.workspace_id
            WHERE parent.id IS NULL
            LIMIT 1
            """,
        ),
        (
            "paper_records",
            """
            SELECT 1
            FROM paper_records AS child
            LEFT JOIN spaces AS parent
              ON parent.id = child.space_id
             AND parent.workspace_id = child.workspace_id
            WHERE parent.id IS NULL
            LIMIT 1
            """,
        ),
    )
    for table_name, statement in checks:
        if connection.execute(sa.text(statement)).first() is not None:
            raise RuntimeError(
                f"V20-02 stopped: {table_name} contains a cross-scope or orphan Space reference"
            )


def _create_parent_scope_keys() -> None:
    context = op.get_context()
    with context.autocommit_block():
        for index_name, table_name, columns in _PARENT_SCOPE_INDEXES:
            op.create_index(
                index_name,
                table_name,
                list(columns),
                unique=True,
                postgresql_concurrently=True,
            )

    for index_name, table_name, _columns in _PARENT_SCOPE_INDEXES:
        op.execute(
            sa.text(
                f"ALTER TABLE {table_name} "
                f"ADD CONSTRAINT {index_name} UNIQUE USING INDEX {index_name}"
            )
        )


def _create_existing_scope_foreign_keys() -> None:
    for constraint_name, table_name in _EXISTING_SCOPE_FOREIGN_KEYS:
        op.execute(
            sa.text(
                f"ALTER TABLE {table_name} "
                f"ADD CONSTRAINT {constraint_name} "
                "FOREIGN KEY (space_id, workspace_id) "
                "REFERENCES spaces (id, workspace_id) "
                "ON DELETE CASCADE NOT VALID"
            )
        )
    for constraint_name, table_name in _EXISTING_SCOPE_FOREIGN_KEYS:
        op.execute(sa.text(f"ALTER TABLE {table_name} VALIDATE CONSTRAINT {constraint_name}"))


def _create_source_excerpts() -> None:
    op.create_table(
        "source_excerpts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("resource_version", sa.BigInteger(), nullable=False),
        sa.Column("source_version_key", sa.Text(), nullable=False),
        sa.Column("source_file_sha256", sa.String(length=64)),
        sa.Column("source_version_sha256", sa.String(length=64), nullable=False),
        sa.Column("excerpt_text", sa.Text(), nullable=False),
        sa.Column("excerpt_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "hash_algorithm",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'sha256'"),
        ),
        sa.Column(
            "normalization_version",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'utf8-nfc-lf-v1'"),
        ),
        sa.Column("page_start", sa.Integer()),
        sa.Column("page_end", sa.Integer()),
        sa.Column("char_start", sa.BigInteger()),
        sa.Column("char_end", sa.BigInteger()),
        sa.Column("section_locator", sa.String(length=512)),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "updated_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("stale_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            name="fk_source_excerpt_resource_scope",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("resource_version >= 1", name="ck_source_excerpt_resource_version"),
        sa.CheckConstraint(
            "char_length(excerpt_text) BETWEEN 1 AND 20000 AND octet_length(excerpt_text) <= 32768",
            name="ck_source_excerpt_text_bounds",
        ),
        sa.CheckConstraint(
            "char_length(btrim(source_version_key)) >= 1 "
            "AND octet_length(source_version_key) <= 512",
            name="ck_source_excerpt_version_key",
        ),
        sa.CheckConstraint(
            "hash_algorithm = 'sha256' AND normalization_version = 'utf8-nfc-lf-v1'",
            name="ck_source_excerpt_hash_profile",
        ),
        sa.CheckConstraint(
            "source_version_sha256 ~ '^[0-9a-f]{64}$' "
            "AND excerpt_sha256 ~ '^[0-9a-f]{64}$' "
            "AND (source_file_sha256 IS NULL "
            "OR source_file_sha256 ~ '^[0-9a-f]{64}$')",
            name="ck_source_excerpt_hashes",
        ),
        sa.CheckConstraint(
            "(page_start IS NULL AND page_end IS NULL) "
            "OR (page_start IS NOT NULL AND page_end IS NOT NULL "
            "AND page_start BETWEEN 1 AND 100000 "
            "AND page_end BETWEEN page_start AND 100000)",
            name="ck_source_excerpt_page_locator",
        ),
        sa.CheckConstraint(
            "(char_start IS NULL AND char_end IS NULL) "
            "OR (char_start IS NOT NULL AND char_end IS NOT NULL "
            "AND char_start >= 0 AND char_end > char_start "
            "AND char_end <= 1000000000)",
            name="ck_source_excerpt_char_locator",
        ),
        sa.CheckConstraint(
            "section_locator IS NULL OR char_length(btrim(section_locator)) BETWEEN 1 AND 512",
            name="ck_source_excerpt_section_locator",
        ),
        sa.CheckConstraint(
            "page_start IS NOT NULL OR char_start IS NOT NULL OR section_locator IS NOT NULL",
            name="ck_source_excerpt_locator_present",
        ),
        sa.CheckConstraint("version >= 1", name="ck_source_excerpt_version"),
        sa.CheckConstraint(
            "(status = 'active' AND stale_at IS NULL AND deleted_at IS NULL) "
            "OR (status = 'stale' AND stale_at IS NOT NULL AND deleted_at IS NULL) "
            "OR (status = 'deleted' AND deleted_at IS NOT NULL)",
            name="ck_source_excerpt_lifecycle",
        ),
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_source_excerpt_scope"),
    )
    op.create_index(
        "ix_source_excerpts_active_resource",
        "source_excerpts",
        ["workspace_id", "space_id", "resource_id", "created_at", "id"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "ix_source_excerpts_active_hash",
        "source_excerpts",
        ["workspace_id", "space_id", "excerpt_sha256"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "ix_source_excerpts_stale",
        "source_excerpts",
        ["workspace_id", "space_id", "stale_at", "id"],
        postgresql_where=sa.text("status = 'stale'"),
    )


def _create_knowledge_citations() -> None:
    op.create_table(
        "knowledge_citations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("source_excerpt_id", sa.Uuid(), nullable=False),
        sa.Column("relationship_kind", sa.String(length=32), nullable=False),
        sa.Column("relation_note", sa.Text()),
        sa.Column("topic_id", sa.Uuid()),
        sa.Column("quiz_item_id", sa.Uuid()),
        sa.Column("research_claim_id", sa.Uuid()),
        sa.Column("research_claim_user_id", sa.Uuid()),
        sa.Column("note_id", sa.Uuid()),
        sa.Column("accepted_draft_id", sa.Uuid()),
        sa.Column("acceptance_operation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "accepted_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
        sa.Column("version", sa.BigInteger(), nullable=False, server_default="1"),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("closed_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("close_reason", sa.String(length=32)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["source_excerpt_id", "workspace_id", "space_id"],
            ["source_excerpts.id", "source_excerpts.workspace_id", "source_excerpts.space_id"],
            name="fk_knowledge_citation_excerpt_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_knowledge_citation_topic_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["quiz_item_id", "workspace_id", "space_id"],
            ["quiz_items.id", "quiz_items.workspace_id", "quiz_items.space_id"],
            name="fk_knowledge_citation_quiz_item_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            [
                "research_claim_id",
                "workspace_id",
                "space_id",
                "research_claim_user_id",
            ],
            [
                "research_claims.id",
                "research_claims.workspace_id",
                "research_claims.space_id",
                "research_claims.user_id",
            ],
            name="fk_knowledge_citation_research_claim_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["note_id", "workspace_id", "space_id"],
            ["notes.id", "notes.workspace_id", "notes.space_id"],
            name="fk_knowledge_citation_note_scope",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["accepted_draft_id", "workspace_id"],
            ["ai_output_drafts.id", "ai_output_drafts.workspace_id"],
            name="fk_knowledge_citation_draft_workspace",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "relationship_kind IN "
            "('source','definition','support','contradiction','example','derivation')",
            name="ck_knowledge_citation_relationship",
        ),
        sa.CheckConstraint(
            "relation_note IS NULL "
            "OR (char_length(relation_note) <= 2000 "
            "AND octet_length(relation_note) <= 8192)",
            name="ck_knowledge_citation_note_bounds",
        ),
        sa.CheckConstraint(
            "num_nonnulls(topic_id, quiz_item_id, research_claim_id, note_id) = 1",
            name="ck_knowledge_citation_one_target",
        ),
        sa.CheckConstraint(
            "(research_claim_id IS NULL AND research_claim_user_id IS NULL) "
            "OR (research_claim_id IS NOT NULL AND research_claim_user_id IS NOT NULL)",
            name="ck_knowledge_citation_claim_pair",
        ),
        sa.CheckConstraint("version >= 1", name="ck_knowledge_citation_version"),
        sa.CheckConstraint(
            "close_reason IS NULL OR close_reason IN "
            "('excerpt_stale','excerpt_deleted','target_deleted','target_moved',"
            "'superseded','user_withdrawn')",
            name="ck_knowledge_citation_close_reason",
        ),
        sa.CheckConstraint(
            "(status = 'active' AND closed_by IS NULL AND closed_at IS NULL "
            "AND close_reason IS NULL AND deleted_at IS NULL) "
            "OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL "
            "AND close_reason IS NOT NULL AND deleted_at IS NULL) "
            "OR (status = 'deleted' AND closed_by IS NOT NULL AND closed_at IS NOT NULL "
            "AND close_reason IS NOT NULL AND deleted_at IS NOT NULL)",
            name="ck_knowledge_citation_lifecycle",
        ),
        sa.UniqueConstraint("id", "workspace_id", "space_id", name="uq_knowledge_citation_scope"),
    )
    op.create_index(
        "ix_knowledge_citations_active_excerpt",
        "knowledge_citations",
        ["workspace_id", "space_id", "source_excerpt_id", "created_at", "id"],
        postgresql_where=sa.text("status = 'active'"),
    )
    op.create_index(
        "ix_knowledge_citations_acceptance_operation",
        "knowledge_citations",
        ["workspace_id", "acceptance_operation_id", "id"],
    )
    for target in ("topic", "quiz_item", "research_claim", "note"):
        op.create_index(
            f"ix_knowledge_citations_active_{target}",
            "knowledge_citations",
            ["workspace_id", "space_id", f"{target}_id", "created_at", "id"],
            postgresql_where=sa.text(f"status = 'active' AND {target}_id IS NOT NULL"),
        )
        op.create_index(
            f"uq_knowledge_citation_active_{target}",
            "knowledge_citations",
            [
                "workspace_id",
                "space_id",
                "source_excerpt_id",
                "relationship_kind",
                f"{target}_id",
            ],
            unique=True,
            postgresql_where=sa.text(f"status = 'active' AND {target}_id IS NOT NULL"),
        )


def upgrade() -> None:
    _assert_existing_scope_integrity()
    _create_parent_scope_keys()
    _create_existing_scope_foreign_keys()
    _create_source_excerpts()
    _create_knowledge_citations()


def downgrade() -> None:
    if _is_offline_mode():
        raise RuntimeError(
            "V20-02 offline downgrade is disabled because table emptiness cannot be proven"
        )

    connection = op.get_bind()
    if connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM knowledge_citations)")).scalar():
        raise RuntimeError("V20-02 downgrade stopped: knowledge_citations is not empty")
    if connection.execute(sa.text("SELECT EXISTS (SELECT 1 FROM source_excerpts)")).scalar():
        raise RuntimeError("V20-02 downgrade stopped: source_excerpts is not empty")

    for index_name in _CITATION_INDEXES:
        op.drop_index(index_name, table_name="knowledge_citations")
    op.drop_table("knowledge_citations")
    for index_name in _EXCERPT_INDEXES:
        op.drop_index(index_name, table_name="source_excerpts")
    op.drop_table("source_excerpts")

    for constraint_name, table_name in reversed(_EXISTING_SCOPE_FOREIGN_KEYS):
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")
    for constraint_name, table_name, _columns in reversed(_PARENT_SCOPE_INDEXES):
        op.drop_constraint(constraint_name, table_name, type_="unique")
