from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from logion_api.db import Base, utc_now


class PdfCacheEntry(Base):
    __tablename__ = "pdf_cache_entries"
    __table_args__ = (
        CheckConstraint("sha256 ~ '^[a-f0-9]{64}$'", name="ck_pdf_cache_sha"),
        CheckConstraint(
            "size_bytes > 0 AND encrypted_bytes = size_bytes + 16", name="ck_pdf_cache_size"
        ),
    )
    sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    storage_key: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    encrypted_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class PdfCacheBinding(Base):
    __tablename__ = "pdf_cache_bindings"
    resource_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True
    )
    sha256: Mapped[str] = mapped_column(
        String(64), ForeignKey("pdf_cache_entries.sha256", ondelete="CASCADE"), nullable=False
    )
    credential_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("integration_credentials.id", ondelete="CASCADE"), nullable=False
    )
    credential_revision: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    locator_digest: Mapped[str] = mapped_column(String(64), nullable=False)


class WebDAVUsage(Base):
    __tablename__ = "webdav_monthly_usage"
    __table_args__ = (CheckConstraint("downloaded_bytes >= 0", name="ck_webdav_usage_bytes"),)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    downloaded_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
