from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now
from logion_api.integrations.keyring import Envelope


class IntegrationCredential(Base):
    __tablename__ = "integration_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", "provider", name="uq_integration_owner_provider"),
        CheckConstraint("provider IN ('zotero','webdav')", name="ck_integration_provider"),
        CheckConstraint(
            "octet_length(nonce) = 12 AND octet_length(key_nonce) = 12",
            name="ck_integration_nonces",
        ),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_code: Mapped[str | None] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    @property
    def aad(self) -> bytes:
        return f"logion:integration:v1:{self.user_id}:{self.provider}:{self.id}".encode()

    @property
    def envelope(self) -> Envelope:
        return Envelope(self.ciphertext, self.nonce, self.wrapped_key, self.key_nonce, self.key_id)
