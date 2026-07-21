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
        UniqueConstraint("id", "workspace_id", name="uq_note_workspace"),
        Index("ix_notes_workspace_space_updated", "workspace_id", "space_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID | None] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    markdown_body: Mapped[str] = mapped_column(Text, nullable=False, default="")
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
        CheckConstraint("resource_type IN ('link','pdf_index')", name="ck_resources_type"),
        CheckConstraint(
            "page_count IS NULL OR page_count BETWEEN 1 AND 100000", name="ck_resources_pages"
        ),
        CheckConstraint("jsonb_typeof(page_index) = 'array'", name="ck_resources_page_index"),
        UniqueConstraint("id", "workspace_id", name="uq_resource_workspace"),
        Index("ix_resources_workspace_space_updated", "workspace_id", "space_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID | None] = mapped_column(Uuid)
    resource_type: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
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
