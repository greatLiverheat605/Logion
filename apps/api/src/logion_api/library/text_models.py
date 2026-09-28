from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class SourceText(Base):
    __tablename__ = "source_texts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["resource_id", "workspace_id", "space_id"],
            ["resources.id", "resources.workspace_id", "resources.space_id"],
            ondelete="CASCADE",
            name="fk_source_text_resource_scope",
        ),
        UniqueConstraint("resource_id", "file_sha256", name="uq_source_text_file"),
        CheckConstraint("file_sha256 ~ '^[a-f0-9]{64}$'", name="ck_source_text_file_sha"),
        CheckConstraint(
            "normalization_version = 'utf8-nfc-lf-v1'", name="ck_source_text_normalization"
        ),
        CheckConstraint("octet_length(text) <= 5242880", name="ck_source_text_size"),
        CheckConstraint("jsonb_typeof(page_offsets) = 'array'", name="ck_source_text_pages"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    resource_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    page_offsets: Mapped[list[dict[str, int]]] = mapped_column(JSONB, nullable=False)
    extracted_by: Mapped[str] = mapped_column(String(80), nullable=False)
    normalization_version: Mapped[str] = mapped_column(
        String(32), nullable=False, default="utf8-nfc-lf-v1"
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
