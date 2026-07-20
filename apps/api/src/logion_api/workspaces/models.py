from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class Workspace(Base):
    __tablename__ = "workspaces"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'suspended', 'deleted')",
            name="ck_workspaces_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceMembership(Base):
    __tablename__ = "workspace_memberships"
    __table_args__ = (
        CheckConstraint(
            "role IN ('owner', 'admin', 'editor', 'contributor', 'reviewer', 'viewer')",
            name="ck_workspace_memberships_role",
        ),
        CheckConstraint(
            "status IN ('invited', 'active', 'suspended', 'revoked')",
            name="ck_workspace_memberships_status",
        ),
        UniqueConstraint("workspace_id", "user_id", name="uq_membership_workspace_user"),
        Index("ix_workspace_memberships_user_status", "user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Space(Base):
    __tablename__ = "spaces"
    __table_args__ = (
        CheckConstraint(
            "visibility IN ('private', 'shared')",
            name="ck_spaces_visibility",
        ),
        CheckConstraint(
            "status IN ('active', 'archived', 'deleted')",
            name="ck_spaces_status",
        ),
        CheckConstraint(
            "visibility = 'shared' OR owner_user_id IS NOT NULL",
            name="ck_spaces_private_owner",
        ),
        Index("ix_spaces_workspace_visibility", "workspace_id", "visibility", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    owner_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    visibility: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    updated_by: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"
    __table_args__ = (
        CheckConstraint(
            "role IN ('admin', 'editor', 'contributor', 'reviewer', 'viewer')",
            name="ck_workspace_invitations_role",
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'revoked', 'expired')",
            name="ck_workspace_invitations_status",
        ),
        Index(
            "ix_workspace_invitations_workspace_email_status",
            "workspace_id",
            "email_normalized",
            "status",
        ),
        Index("ix_workspace_invitations_expiry", "status", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email_normalized: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    invited_by: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    accepted_by: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    revoked_by: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
