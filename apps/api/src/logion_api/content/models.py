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
    LargeBinary,
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


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_note_task_workspace",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_note_space_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_note_workspace"),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_note_scope"),
        Index("ix_notes_workspace_space_updated", "workspace_id", "space_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID | None] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    markdown_body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    yjs_state: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    yjs_generation: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Resource(Base):
    __tablename__ = "resources"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_resource_task_workspace",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_resource_space_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "resource_type IN ('link','pdf_index','paper','book','preprint','web')",
            name="ck_resources_type",
        ),
        CheckConstraint(
            "resource_type IN ('link','pdf_index') OR research_owner_id IS NOT NULL",
            name="ck_resources_research_owner",
        ),
        CheckConstraint("jsonb_typeof(csl) = 'object'", name="ck_resources_csl"),
        CheckConstraint("jsonb_typeof(tags) = 'array'", name="ck_resources_tags"),
        CheckConstraint(
            "file_locator IS NULL OR jsonb_typeof(file_locator) = 'object'",
            name="ck_resources_file_locator",
        ),
        CheckConstraint(
            "reading_status IN ('unread','skimmed','reading','close_read','archived')",
            name="ck_resources_reading_status",
        ),
        CheckConstraint(
            "zotero_version IS NULL OR zotero_version >= 0", name="ck_resources_zotero_version"
        ),
        UniqueConstraint(
            "id",
            "workspace_id",
            "space_id",
            "research_owner_id",
            name="uq_resource_research_scope",
        ),
        UniqueConstraint("legacy_paper_id", name="uq_resource_legacy_paper"),
        *(
            Index(
                f"uq_resources_owner_{identifier}",
                "space_id",
                "research_owner_id",
                identifier,
                unique=True,
                postgresql_where=text(
                    f"{identifier} IS NOT NULL AND research_owner_id IS NOT NULL "
                    "AND deleted_at IS NULL"
                ),
            )
            for identifier in ("doi", "arxiv_id", "pmid")
        ),
        CheckConstraint(
            "page_count IS NULL OR page_count BETWEEN 1 AND 100000", name="ck_resources_pages"
        ),
        CheckConstraint("jsonb_typeof(page_index) = 'array'", name="ck_resources_page_index"),
        UniqueConstraint("id", "workspace_id", name="uq_resource_workspace"),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_resource_scope"),
        Index("ix_resources_workspace_space_updated", "workspace_id", "space_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID | None] = mapped_column(Uuid)
    resource_type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    research_owner_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE")
    )
    legacy_paper_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("paper_records.id", ondelete="SET NULL")
    )
    csl: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    doi: Mapped[str | None] = mapped_column(String(255))
    arxiv_id: Mapped[str | None] = mapped_column(String(80))
    pmid: Mapped[str | None] = mapped_column(String(20))
    citation_key: Mapped[str | None] = mapped_column(String(160))
    tags: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list, server_default=text("'[]'::jsonb")
    )
    zotero_library_id: Mapped[str | None] = mapped_column(String(80))
    zotero_item_key: Mapped[str | None] = mapped_column(String(80))
    zotero_version: Mapped[int | None] = mapped_column(BigInteger)
    file_locator: Mapped[dict[str, object] | None] = mapped_column(JSONB(none_as_null=True))
    reading_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unread", server_default="unread"
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pdf_filename: Mapped[str | None] = mapped_column(String(255))
    page_count: Mapped[int | None] = mapped_column(Integer)
    sha256: Mapped[str | None] = mapped_column(String(64))
    page_index: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_upload','uploading','verified','failed','deleted')",
            name="ck_attachments_status",
        ),
        CheckConstraint(
            "target_type IN ('note','evidence_item','experiment_run')",
            name="ck_attachments_target_type",
        ),
        CheckConstraint("size_bytes BETWEEN 1 AND 104857600", name="ck_attachments_size"),
        CheckConstraint("expected_sha256 ~ '^[0-9a-f]{64}$'", name="ck_attachments_expected_sha"),
        CheckConstraint(
            "verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_attachments_verified_sha",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_attachment_workspace"),
        Index("ix_attachments_workspace_space_status", "workspace_id", "space_id", "status"),
        Index("ix_attachments_owner_status", "created_by", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    space_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    declared_mime: Mapped[str] = mapped_column(String(80), nullable=False)
    detected_mime: Mapped[str | None] = mapped_column(String(80))
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    expected_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    verified_sha256: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending_upload")
    staging_key: Mapped[str] = mapped_column(String(64), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(160))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
