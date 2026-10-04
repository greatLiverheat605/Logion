from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class FormDraft(Base):
    __tablename__ = "form_drafts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_form_draft_space",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "user_id", "space_id", "form_kind", "target_key", name="uq_form_draft_slot"
        ),
        CheckConstraint("version >= 1", name="ck_form_draft_version"),
        CheckConstraint(
            "jsonb_typeof(fields) = 'object' AND octet_length(fields::text) <= 4194304",
            name="ck_form_draft_fields",
        ),
        Index("ix_form_drafts_expiry", "expires_at"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    form_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    target_key: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    fields: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
