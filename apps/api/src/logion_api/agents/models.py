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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class AgentToken(Base):
    __tablename__ = "agent_tokens"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_agent_token_space",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "user_id", "workspace_id", "space_id", name="uq_agent_token_scope"),
        CheckConstraint("token_digest ~ '^[0-9a-f]{64}$'", name="ck_agent_token_digest"),
        CheckConstraint(
            "jsonb_typeof(scopes) = 'array' AND jsonb_array_length(scopes) BETWEEN 1 AND "
            "2 AND scopes <@ jsonb_build_array('read','inbox:write')",
            name="ck_agent_token_scopes",
        ),
        CheckConstraint("expires_at > created_at", name="ck_agent_token_expiry"),
        Index("ix_agent_tokens_owner", "user_id", "created_at"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    token_digest: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    scopes: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentInboxItem(Base):
    __tablename__ = "agent_inbox_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["token_id", "user_id", "workspace_id", "space_id"],
            [
                "agent_tokens.id",
                "agent_tokens.user_id",
                "agent_tokens.workspace_id",
                "agent_tokens.space_id",
            ],
            name="fk_agent_inbox_token_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", "space_id", "user_id", name="uq_agent_inbox_scope"),
        UniqueConstraint("token_id", "submission_key", name="uq_agent_inbox_submission"),
        CheckConstraint("kind IN ('source','report','summary','edge')", name="ck_agent_inbox_kind"),
        CheckConstraint(
            "status IN ('pending','accepted','discarded')", name="ck_agent_inbox_status"
        ),
        CheckConstraint(
            "jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 131072",
            name="ck_agent_inbox_payload",
        ),
        CheckConstraint("payload_digest ~ '^[0-9a-f]{64}$'", name="ck_agent_inbox_digest"),
        CheckConstraint(
            "(status = 'pending' AND decided_at IS NULL AND decision_digest IS NULL AND "
            "receipt IS NULL AND accepted_payload IS NULL) OR (status = 'accepted' AND "
            "decided_at IS NOT NULL AND decision_digest IS NOT NULL AND receipt IS NOT "
            "NULL AND accepted_payload IS NOT NULL) OR (status = 'discarded' AND "
            "decided_at IS NOT NULL AND decision_digest IS NOT NULL AND receipt IS NULL "
            "AND accepted_payload IS NULL)",
            name="ck_agent_inbox_decision",
        ),
        Index("ix_agent_inbox_owner_status", "user_id", "space_id", "status", "id"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    token_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    submission_key: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    payload_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="pending", server_default="pending"
    )
    version: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=1, server_default=text("1")
    )
    accepted_payload: Mapped[dict[str, object] | None] = mapped_column(JSONB(none_as_null=True))
    receipt: Mapped[dict[str, str] | None] = mapped_column(JSONB(none_as_null=True))
    decision_digest: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
