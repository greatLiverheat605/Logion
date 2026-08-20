from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class WorkbenchDefinition(Base):
    __tablename__ = "workbench_definitions"
    __table_args__ = (
        CheckConstraint(
            "lifecycle IN ('active','archived')",
            name="ck_workbench_definition_lifecycle",
        ),
        CheckConstraint("revision >= 1", name="ck_workbench_definition_revision"),
        CheckConstraint(
            "link_set_revision >= 1",
            name="ck_workbench_definition_link_set_revision",
        ),
        CheckConstraint(
            "jsonb_typeof(document) = 'object'",
            name="ck_workbench_definition_document_object",
        ),
        CheckConstraint(
            "char_length(btrim(name)) BETWEEN 1 AND 80",
            name="ck_workbench_definition_name",
        ),
        CheckConstraint(
            "char_length(description) <= 280",
            name="ck_workbench_definition_description",
        ),
        CheckConstraint(
            "icon IN ('book-open','microscope','graduation-cap','users',"
            "'layout-dashboard','target','folder','note')",
            name="ck_workbench_definition_icon",
        ),
        CheckConstraint(
            "accent IN ('neutral','blue','green','amber','red','violet','cyan')",
            name="ck_workbench_definition_accent",
        ),
        CheckConstraint(
            "template_id IN ('fixed.learning','fixed.research','fixed.exam',"
            "'fixed.mentor','blank')",
            name="ck_workbench_definition_template",
        ),
        UniqueConstraint("id", "owner_user_id", name="uq_workbench_definition_owner"),
        Index(
            "ix_workbench_definitions_owner_lifecycle_updated",
            "owner_user_id",
            "lifecycle",
            "updated_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    owner_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(String(280), nullable=False, default="")
    icon: Mapped[str] = mapped_column(String(24), nullable=False)
    accent: Mapped[str] = mapped_column(String(12), nullable=False)
    template_id: Mapped[str] = mapped_column(String(24), nullable=False)
    lifecycle: Mapped[Literal["active", "archived"]] = mapped_column(
        String(16),
        nullable=False,
        default="active",
    )
    document: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    link_set_revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )


class WorkbenchLink(Base):
    __tablename__ = "workbench_links"
    __table_args__ = (
        ForeignKeyConstraint(
            ["workbench_id", "owner_user_id"],
            ["workbench_definitions.id", "workbench_definitions.owner_user_id"],
            name="fk_workbench_link_definition_owner",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "target_kind IN ('task','source','topic','note','evidence','claim','project')",
            name="ck_workbench_link_target_kind",
        ),
        CheckConstraint("position BETWEEN 0 AND 499", name="ck_workbench_link_position"),
        CheckConstraint("revision >= 1", name="ck_workbench_link_revision"),
        CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="ck_workbench_link_attributes",
        ),
        UniqueConstraint(
            "workbench_id",
            "target_kind",
            "target_id",
            name="uq_workbench_link_target",
        ),
        Index(
            "ix_workbench_links_workbench_position",
            "workbench_id",
            "position",
            "id",
        ),
        Index(
            "ix_workbench_links_owner_workbench",
            "owner_user_id",
            "workbench_id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workbench_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    owner_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_kind: Mapped[
        Literal["task", "source", "topic", "note", "evidence", "claim", "project"]
    ] = mapped_column(String(16), nullable=False)
    target_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    primary_context: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    attributes: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False, default=dict)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )


class WorkbenchIdempotencyReceipt(Base):
    __tablename__ = "workbench_idempotency_receipts"
    __table_args__ = (
        CheckConstraint(
            "operation IN ('workbench.definition.create.v1','workbench.definition.delete.v1',"
            "'workbench.link.create.v1','workbench.import.v1')",
            name="ck_workbench_receipt_operation",
        ),
        CheckConstraint(
            "request_fingerprint ~ '^sha256:[0-9a-f]{64}$'",
            name="ck_workbench_receipt_fingerprint",
        ),
        CheckConstraint(
            "outcome IN ('succeeded','failed')",
            name="ck_workbench_receipt_outcome",
        ),
        CheckConstraint("retryable = false", name="ck_workbench_receipt_terminal"),
        CheckConstraint(
            "jsonb_typeof(response_snapshot) = 'object'",
            name="ck_workbench_receipt_snapshot_object",
        ),
        UniqueConstraint(
            "owner_user_id",
            "idempotency_key",
            name="uq_workbench_receipt_owner_key",
        ),
        Index(
            "ix_workbench_receipts_owner_created",
            "owner_user_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    owner_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    operation: Mapped[
        Literal[
            "workbench.definition.create.v1",
            "workbench.definition.delete.v1",
            "workbench.link.create.v1",
            "workbench.import.v1",
        ]
    ] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(71), nullable=False)
    outcome: Mapped[Literal["succeeded", "failed"]] = mapped_column(String(16), nullable=False)
    retryable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The identifier must survive Definition deletion so an accepted request can be replayed.
    definition_id: Mapped[UUID | None] = mapped_column(Uuid)
    response_snapshot: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
