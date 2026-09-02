from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class SourceExcerpt(Base):
    __tablename__ = "source_excerpts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            name="fk_source_excerpt_resource_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint("resource_version >= 1", name="ck_source_excerpt_resource_version"),
        CheckConstraint(
            "char_length(excerpt_text) BETWEEN 1 AND 20000 AND octet_length(excerpt_text) <= 32768",
            name="ck_source_excerpt_text_bounds",
        ),
        CheckConstraint(
            "char_length(btrim(source_version_key)) >= 1 "
            "AND octet_length(source_version_key) <= 512",
            name="ck_source_excerpt_version_key",
        ),
        CheckConstraint(
            "hash_algorithm = 'sha256' AND normalization_version = 'utf8-nfc-lf-v1'",
            name="ck_source_excerpt_hash_profile",
        ),
        CheckConstraint(
            "source_version_sha256 ~ '^[0-9a-f]{64}$' "
            "AND excerpt_sha256 ~ '^[0-9a-f]{64}$' "
            "AND (source_file_sha256 IS NULL "
            "OR source_file_sha256 ~ '^[0-9a-f]{64}$')",
            name="ck_source_excerpt_hashes",
        ),
        CheckConstraint(
            "(page_start IS NULL AND page_end IS NULL) "
            "OR (page_start IS NOT NULL AND page_end IS NOT NULL "
            "AND page_start BETWEEN 1 AND 100000 "
            "AND page_end BETWEEN page_start AND 100000)",
            name="ck_source_excerpt_page_locator",
        ),
        CheckConstraint(
            "(char_start IS NULL AND char_end IS NULL) "
            "OR (char_start IS NOT NULL AND char_end IS NOT NULL "
            "AND char_start >= 0 AND char_end > char_start "
            "AND char_end <= 1000000000)",
            name="ck_source_excerpt_char_locator",
        ),
        CheckConstraint(
            "section_locator IS NULL OR char_length(btrim(section_locator)) BETWEEN 1 AND 512",
            name="ck_source_excerpt_section_locator",
        ),
        CheckConstraint(
            "page_start IS NOT NULL OR char_start IS NOT NULL OR section_locator IS NOT NULL",
            name="ck_source_excerpt_locator_present",
        ),
        CheckConstraint("version >= 1", name="ck_source_excerpt_version"),
        CheckConstraint(
            "(status = 'active' AND stale_at IS NULL AND deleted_at IS NULL) "
            "OR (status = 'stale' AND stale_at IS NOT NULL AND deleted_at IS NULL) "
            "OR (status = 'deleted' AND deleted_at IS NOT NULL)",
            name="ck_source_excerpt_lifecycle",
        ),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_source_excerpt_scope"),
        Index(
            "ix_source_excerpts_active_resource",
            "workspace_id",
            "space_id",
            "resource_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_source_excerpts_active_hash",
            "workspace_id",
            "space_id",
            "excerpt_sha256",
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_source_excerpts_stale",
            "workspace_id",
            "space_id",
            "stale_at",
            "id",
            postgresql_where=text("status = 'stale'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    resource_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    resource_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    source_version_key: Mapped[str] = mapped_column(Text, nullable=False)
    source_file_sha256: Mapped[str | None] = mapped_column(String(64))
    source_version_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    excerpt_text: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    hash_algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default="sha256")
    normalization_version: Mapped[str] = mapped_column(
        String(32), nullable=False, default="utf8-nfc-lf-v1"
    )
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    char_start: Mapped[int | None] = mapped_column(BigInteger)
    char_end: Mapped[int | None] = mapped_column(BigInteger)
    section_locator: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    stale_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class KnowledgeCitation(Base):
    __tablename__ = "knowledge_citations"
    __table_args__ = (
        ForeignKeyConstraint(
            ["source_excerpt_id", "workspace_id", "space_id"],
            ["source_excerpts.id", "source_excerpts.workspace_id", "source_excerpts.space_id"],
            name="fk_knowledge_citation_excerpt_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_knowledge_citation_topic_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["quiz_item_id", "workspace_id", "space_id"],
            ["quiz_items.id", "quiz_items.workspace_id", "quiz_items.space_id"],
            name="fk_knowledge_citation_quiz_item_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["research_claim_id", "workspace_id", "space_id", "research_claim_user_id"],
            [
                "research_claims.id",
                "research_claims.workspace_id",
                "research_claims.space_id",
                "research_claims.user_id",
            ],
            name="fk_knowledge_citation_research_claim_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["note_id", "workspace_id", "space_id"],
            ["notes.id", "notes.workspace_id", "notes.space_id"],
            name="fk_knowledge_citation_note_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["accepted_draft_id", "workspace_id"],
            ["ai_output_drafts.id", "ai_output_drafts.workspace_id"],
            name="fk_knowledge_citation_draft_workspace",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "relationship_kind IN "
            "('source','definition','support','contradiction','example','derivation')",
            name="ck_knowledge_citation_relationship",
        ),
        CheckConstraint(
            "relation_note IS NULL "
            "OR (char_length(relation_note) <= 2000 "
            "AND octet_length(relation_note) <= 8192)",
            name="ck_knowledge_citation_note_bounds",
        ),
        CheckConstraint(
            "num_nonnulls(topic_id, quiz_item_id, research_claim_id, note_id) = 1",
            name="ck_knowledge_citation_one_target",
        ),
        CheckConstraint(
            "(research_claim_id IS NULL AND research_claim_user_id IS NULL) "
            "OR (research_claim_id IS NOT NULL AND research_claim_user_id IS NOT NULL)",
            name="ck_knowledge_citation_claim_pair",
        ),
        CheckConstraint("version >= 1", name="ck_knowledge_citation_version"),
        CheckConstraint(
            "close_reason IS NULL OR close_reason IN "
            "('excerpt_stale','excerpt_deleted','target_deleted','target_moved',"
            "'superseded','user_withdrawn')",
            name="ck_knowledge_citation_close_reason",
        ),
        CheckConstraint(
            "(status = 'active' AND closed_by IS NULL AND closed_at IS NULL "
            "AND close_reason IS NULL AND deleted_at IS NULL) "
            "OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL "
            "AND close_reason IS NOT NULL AND deleted_at IS NULL) "
            "OR (status = 'deleted' AND closed_by IS NOT NULL AND closed_at IS NOT NULL "
            "AND close_reason IS NOT NULL AND deleted_at IS NOT NULL)",
            name="ck_knowledge_citation_lifecycle",
        ),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_knowledge_citation_scope"),
        Index(
            "ix_knowledge_citations_active_excerpt",
            "workspace_id",
            "space_id",
            "source_excerpt_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active'"),
        ),
        Index(
            "ix_knowledge_citations_acceptance_operation",
            "workspace_id",
            "acceptance_operation_id",
            "id",
        ),
        Index(
            "ix_knowledge_citations_active_topic",
            "workspace_id",
            "space_id",
            "topic_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active' AND topic_id IS NOT NULL"),
        ),
        Index(
            "uq_knowledge_citation_active_topic",
            "workspace_id",
            "space_id",
            "source_excerpt_id",
            "relationship_kind",
            "topic_id",
            unique=True,
            postgresql_where=text("status = 'active' AND topic_id IS NOT NULL"),
        ),
        Index(
            "ix_knowledge_citations_active_quiz_item",
            "workspace_id",
            "space_id",
            "quiz_item_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active' AND quiz_item_id IS NOT NULL"),
        ),
        Index(
            "uq_knowledge_citation_active_quiz_item",
            "workspace_id",
            "space_id",
            "source_excerpt_id",
            "relationship_kind",
            "quiz_item_id",
            unique=True,
            postgresql_where=text("status = 'active' AND quiz_item_id IS NOT NULL"),
        ),
        Index(
            "ix_knowledge_citations_active_research_claim",
            "workspace_id",
            "space_id",
            "research_claim_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active' AND research_claim_id IS NOT NULL"),
        ),
        Index(
            "uq_knowledge_citation_active_research_claim",
            "workspace_id",
            "space_id",
            "source_excerpt_id",
            "relationship_kind",
            "research_claim_id",
            unique=True,
            postgresql_where=text("status = 'active' AND research_claim_id IS NOT NULL"),
        ),
        Index(
            "ix_knowledge_citations_active_note",
            "workspace_id",
            "space_id",
            "note_id",
            "created_at",
            "id",
            postgresql_where=text("status = 'active' AND note_id IS NOT NULL"),
        ),
        Index(
            "uq_knowledge_citation_active_note",
            "workspace_id",
            "space_id",
            "source_excerpt_id",
            "relationship_kind",
            "note_id",
            unique=True,
            postgresql_where=text("status = 'active' AND note_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    source_excerpt_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    relationship_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    relation_note: Mapped[str | None] = mapped_column(Text)
    topic_id: Mapped[UUID | None] = mapped_column(Uuid)
    quiz_item_id: Mapped[UUID | None] = mapped_column(Uuid)
    research_claim_id: Mapped[UUID | None] = mapped_column(Uuid)
    research_claim_user_id: Mapped[UUID | None] = mapped_column(Uuid)
    note_id: Mapped[UUID | None] = mapped_column(Uuid)
    accepted_draft_id: Mapped[UUID | None] = mapped_column(Uuid)
    acceptance_operation_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    accepted_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    closed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    close_reason: Mapped[str | None] = mapped_column(String(32))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class KnowledgeAcceptanceReceipt(Base):
    """Durable result of one successful AI knowledge acceptance.

    The unique scope is intentionally caller-bound: a reused key in another space
    or by another user cannot replay a receipt.  Only identifiers and a payload
    digest are retained; accepted text remains in the draft retention lifecycle.
    """

    __tablename__ = "knowledge_acceptance_receipts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["draft_id", "workspace_id"],
            ["ai_output_drafts.id", "ai_output_drafts.workspace_id"],
            name="fk_knowledge_acceptance_receipt_draft_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_knowledge_acceptance_receipt_space_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["accepted_by"],
            ["users.id"],
            name="fk_knowledge_acceptance_receipt_actor",
            ondelete="RESTRICT",
        ),
        CheckConstraint("status = 'applied'", name="ck_knowledge_acceptance_receipt_status"),
        CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_knowledge_acceptance_receipt_payload_hash",
        ),
        CheckConstraint(
            "jsonb_typeof(created_object_ids) = 'array'",
            name="ck_knowledge_acceptance_receipt_object_ids",
        ),
        UniqueConstraint(
            "workspace_id",
            "accepted_by",
            "idempotency_key",
            name="uq_knowledge_acceptance_receipt_idempotency",
        ),
        Index(
            "ix_knowledge_acceptance_receipt_draft",
            "workspace_id",
            "space_id",
            "draft_id",
            "created_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    draft_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    accepted_by: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    idempotency_key: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="applied")
    created_object_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class LocalWorkerJob(Base):
    """Server-owned scope for one bounded Local Worker execution."""

    __tablename__ = "knowledge_local_worker_jobs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_local_worker_job_space_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "state IN ('queued','running','uploaded','completed','failed')",
            name="ck_local_worker_job_state",
        ),
        CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_job_input_hash",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_local_worker_job_workspace"),
        Index(
            "ix_local_worker_jobs_owner_state",
            "created_by",
            "state",
            "updated_at",
            "id",
        ),
        Index(
            "ix_local_worker_jobs_scope",
            "workspace_id",
            "space_id",
            "state",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LocalWorkerLease(Base):
    """Short-lived bearer capability; only its SHA-256 digest is persisted."""

    __tablename__ = "knowledge_local_worker_leases"
    __table_args__ = (
        ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_lease_job_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_local_worker_lease_space_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "state IN ('active','revoked','expired','completed')",
            name="ck_local_worker_lease_state",
        ),
        CheckConstraint(
            "token_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_lease_token_hash",
        ),
        CheckConstraint("expires_at > issued_at", name="ck_local_worker_lease_expiry"),
        UniqueConstraint("id", "job_id", "workspace_id", name="uq_local_worker_lease_job_scope"),
        Index(
            "ix_local_worker_leases_job_state",
            "job_id",
            "state",
            "expires_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    job_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    token_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LocalWorkerCheckpoint(Base):
    """One bounded, scope-bound recovery marker per job."""

    __tablename__ = "knowledge_local_worker_checkpoints"
    __table_args__ = (
        ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_checkpoint_job_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["lease_id", "job_id", "workspace_id"],
            [
                "knowledge_local_worker_leases.id",
                "knowledge_local_worker_leases.job_id",
                "knowledge_local_worker_leases.workspace_id",
            ],
            name="fk_local_worker_checkpoint_lease_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "stage IN ('claimed','running','uploaded')",
            name="ck_local_worker_checkpoint_stage",
        ),
        CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_checkpoint_input_hash",
        ),
        CheckConstraint(
            "output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_checkpoint_output_hash",
        ),
        CheckConstraint(
            "(stage = 'uploaded' AND output_sha256 IS NOT NULL) "
            "OR (stage <> 'uploaded' AND output_sha256 IS NULL)",
            name="ck_local_worker_checkpoint_uploaded_hash",
        ),
        UniqueConstraint("job_id", name="uq_local_worker_checkpoint_job"),
        Index(
            "ix_local_worker_checkpoints_recovery",
            "workspace_id",
            "space_id",
            "updated_at",
            "job_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    job_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    lease_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    output_sha256: Mapped[str | None] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class LocalWorkerResultReceipt(Base):
    """Durable, idempotent acknowledgement with no raw worker payload."""

    __tablename__ = "knowledge_local_worker_result_receipts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["job_id", "workspace_id"],
            ["knowledge_local_worker_jobs.id", "knowledge_local_worker_jobs.workspace_id"],
            name="fk_local_worker_receipt_job_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["lease_id", "job_id", "workspace_id"],
            [
                "knowledge_local_worker_leases.id",
                "knowledge_local_worker_leases.job_id",
                "knowledge_local_worker_leases.workspace_id",
            ],
            name="fk_local_worker_receipt_lease_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "input_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_input_hash",
        ),
        CheckConstraint(
            "output_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_output_hash",
        ),
        CheckConstraint(
            "payload_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_local_worker_receipt_payload_hash",
        ),
        CheckConstraint(
            "char_length(idempotency_key) BETWEEN 1 AND 128 "
            "AND octet_length(idempotency_key) <= 128 "
            "AND idempotency_key ~ '^[!-~]+$'",
            name="ck_local_worker_receipt_idempotency_key",
        ),
        UniqueConstraint(
            "workspace_id",
            "job_id",
            "idempotency_key",
            name="uq_local_worker_receipt_idempotency",
        ),
        Index(
            "ix_local_worker_receipts_job",
            "workspace_id",
            "space_id",
            "job_id",
            "accepted_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    job_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    lease_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    output_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
