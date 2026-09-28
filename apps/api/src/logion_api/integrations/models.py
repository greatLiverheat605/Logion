from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
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
    retry_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )

    @property
    def aad(self) -> bytes:
        return f"logion:integration:v1:{self.user_id}:{self.provider}:{self.id}".encode()

    @property
    def envelope(self) -> Envelope:
        return Envelope(self.ciphertext, self.nonce, self.wrapped_key, self.key_nonce, self.key_id)


class ZoteroSyncState(Base):
    __tablename__ = "zotero_sync_states"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_zotero_sync_space",
            ondelete="CASCADE",
        ),
        UniqueConstraint("credential_id", "space_id", name="uq_zotero_sync_target"),
        CheckConstraint(
            "phase IN ('collections','items','attachments','annotations','deleted')",
            name="ck_zotero_sync_phase",
        ),
        CheckConstraint(
            "library_version >= 0 AND page_offset >= 0 "
            "AND (target_version IS NULL OR target_version >= 0)",
            name="ck_zotero_sync_versions",
        ),
        CheckConstraint(
            "jsonb_typeof(collections) = 'object' AND jsonb_typeof(item_map) = 'object'",
            name="ck_zotero_sync_maps",
        ),
        Index("ix_zotero_sync_due", "due_at"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    credential_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("integration_credentials.id", ondelete="CASCADE"),
        nullable=False,
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    library_id: Mapped[str | None] = mapped_column(String(80))
    library_version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    target_version: Mapped[int | None] = mapped_column(BigInteger)
    phase: Mapped[str] = mapped_column(String(16), nullable=False, default="collections")
    page_offset: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    collections: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    item_map: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    due_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
