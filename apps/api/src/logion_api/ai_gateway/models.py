from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class AIProvider(Base):
    __tablename__ = "ai_providers"
    __table_args__ = (
        CheckConstraint(
            "provider_type = 'openai_compatible'", name="ck_ai_provider_supported_type"
        ),
        CheckConstraint("timeout_seconds BETWEEN 1 AND 300", name="ck_ai_provider_timeout"),
        CheckConstraint("max_retries BETWEEN 0 AND 5", name="ck_ai_provider_retries"),
        Index(
            "uq_ai_provider_active_name",
            "workspace_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_ai_provider_workspace_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(240), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    credential_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    credential_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    data_key_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    data_key_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    encryption_key_id: Mapped[str | None] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
