from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
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


class TemplatePackage(Base):
    __tablename__ = "template_packages"
    __table_args__ = (
        CheckConstraint(
            "version_number > 0 AND schema_version > 0", name="ck_template_versions_positive"
        ),
        CheckConstraint("status IN ('active','withdrawn')", name="ck_template_status"),
        CheckConstraint("visibility IN ('private','workspace')", name="ck_template_visibility"),
        UniqueConstraint(
            "workspace_id", "template_key", "version_number", name="uq_template_version"
        ),
        Index("ix_template_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    template_key: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    product_min_version: Mapped[str] = mapped_column(String(32), nullable=False)
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    license: Mapped[str] = mapped_column(String(80), nullable=False)
    locale: Mapped[str] = mapped_column(String(35), nullable=False)
    target_personas: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    changelog: Mapped[str] = mapped_column(String(2000), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_metadata: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    object_graph: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    visibility: Mapped[Literal["private", "workspace"]] = mapped_column(
        String(16), nullable=False, default="private"
    )
    status: Mapped[Literal["active", "withdrawn"]] = mapped_column(
        String(16), nullable=False, default="active"
    )
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class TemplateInstallation(Base):
    __tablename__ = "template_installations"
    __table_args__ = (Index("ix_template_install_workspace", "workspace_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    space_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    template_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("template_packages.id", ondelete="RESTRICT"), nullable=False
    )
    template_content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    installed_object_ids: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    installed_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class ShareSnapshot(Base):
    __tablename__ = "share_snapshots"
    __table_args__ = (
        CheckConstraint("object_type = 'goal_plan'", name="ck_share_object_type"),
        CheckConstraint("status IN ('active','revoked')", name="ck_share_status"),
        Index("ix_share_workspace_created", "workspace_id", "created_at"),
        Index("ix_share_expiry", "status", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    space_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    object_type: Mapped[str] = mapped_column(String(32), nullable=False)
    object_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    snapshot: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[Literal["active", "revoked"]] = mapped_column(
        String(16), nullable=False, default="active"
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    revoked_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
