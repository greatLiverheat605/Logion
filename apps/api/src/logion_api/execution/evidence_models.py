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
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_evidence_task_workspace",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["note_id", "workspace_id"],
            ["notes.id", "notes.workspace_id"],
            name="fk_evidence_note_workspace",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["resource_id", "workspace_id"],
            ["resources.id", "resources.workspace_id"],
            name="fk_evidence_resource_workspace",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "evidence_type IN ('text','link','note','resource')", name="ck_evidence_type"
        ),
        CheckConstraint(
            "(evidence_type = 'text' AND note_id IS NULL AND resource_id IS NULL "
            "AND external_url IS NULL AND length(summary) > 0) OR "
            "(evidence_type = 'link' AND note_id IS NULL AND resource_id IS NULL "
            "AND external_url IS NOT NULL) OR "
            "(evidence_type = 'note' AND note_id IS NOT NULL AND resource_id IS NULL "
            "AND external_url IS NULL) OR "
            "(evidence_type = 'resource' AND note_id IS NULL AND resource_id IS NOT NULL "
            "AND external_url IS NULL)",
            name="ck_evidence_shape",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_evidence_workspace"),
        Index("ix_evidence_task_created", "task_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    evidence_type: Mapped[str] = mapped_column(String(16), nullable=False)
    note_id: Mapped[UUID | None] = mapped_column(Uuid)
    resource_id: Mapped[UUID | None] = mapped_column(Uuid)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    external_url: Mapped[str | None] = mapped_column(Text)
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


class VerificationRecord(Base):
    __tablename__ = "verification_records"
    __table_args__ = (
        ForeignKeyConstraint(
            ["evidence_id", "workspace_id"],
            ["evidence_items.id", "evidence_items.workspace_id"],
            name="fk_verification_evidence_workspace",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_verification_task_workspace",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "verdict IN ('pending','passed','failed','needs_revision')",
            name="ck_verification_verdict",
        ),
        CheckConstraint(
            "(verdict = 'pending' AND decided_by IS NULL AND decided_at IS NULL) OR "
            "(verdict <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)",
            name="ck_verification_decision_shape",
        ),
        UniqueConstraint("evidence_id", name="uq_verification_evidence"),
        UniqueConstraint("id", "workspace_id", name="uq_verification_workspace"),
        Index("ix_verification_task_verdict", "task_id", "verdict"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    evidence_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    verdict: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reviewer_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    requested_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    decided_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
