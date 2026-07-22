from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now

MASTERY_LEVELS = (
    "unknown",
    "exposed",
    "practicing",
    "familiar",
    "proficient",
    "mastered",
)
MASTERY_LEVEL_SQL = ",".join(f"'{level}'" for level in MASTERY_LEVELS)


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_topic_scope"),
        Index("ix_topics_workspace_space_updated", "workspace_id", "space_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    space_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
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


class TopicDependency(Base):
    __tablename__ = "topic_dependencies"
    __table_args__ = (
        ForeignKeyConstraint(
            ["prerequisite_topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_topic_dependency_prerequisite_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["dependent_topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_topic_dependency_dependent_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "prerequisite_topic_id <> dependent_topic_id",
            name="ck_topic_dependency_not_self",
        ),
        UniqueConstraint(
            "workspace_id",
            "space_id",
            "prerequisite_topic_id",
            "dependent_topic_id",
            name="uq_topic_dependency_edge",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_topic_dependency_workspace"),
        Index("ix_topic_dependencies_dependent", "dependent_topic_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    prerequisite_topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    dependent_topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
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


class MasteryRecord(Base):
    __tablename__ = "mastery_records"
    __table_args__ = (
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_mastery_topic_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            f"suggested_level IN ({MASTERY_LEVEL_SQL})",
            name="ck_mastery_suggested_level",
        ),
        CheckConstraint(
            f"confirmed_level IS NULL OR confirmed_level IN ({MASTERY_LEVEL_SQL})",
            name="ck_mastery_confirmed_level",
        ),
        CheckConstraint(
            "(confirmed_level IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL) OR "
            "(confirmed_level IS NOT NULL AND confirmed_by IS NOT NULL "
            "AND confirmed_at IS NOT NULL)",
            name="ck_mastery_confirmation_shape",
        ),
        UniqueConstraint("workspace_id", "topic_id", "user_id", name="uq_mastery_topic_user"),
        UniqueConstraint("id", "workspace_id", name="uq_mastery_workspace"),
        Index("ix_mastery_user_level", "workspace_id", "user_id", "confirmed_level"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    suggested_level: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    suggested_reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    suggested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_level: Mapped[str | None] = mapped_column(String(20))
    confirmed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewSchedule(Base):
    __tablename__ = "review_schedules"
    __table_args__ = (
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_review_schedule_topic_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('scheduled','due','in_progress','completed','skipped')",
            name="ck_review_schedule_status",
        ),
        CheckConstraint(
            "source IN ('mastery_confirmation','manual')",
            name="ck_review_schedule_source",
        ),
        CheckConstraint("interval_days BETWEEN 1 AND 3650", name="ck_review_interval_days"),
        UniqueConstraint(
            "workspace_id", "topic_id", "user_id", name="uq_review_schedule_topic_user"
        ),
        UniqueConstraint("id", "workspace_id", name="uq_review_schedule_workspace"),
        Index("ix_review_schedule_user_due", "workspace_id", "user_id", "next_review_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="scheduled")
    source: Mapped[str] = mapped_column(String(24), nullable=False)
    interval_days: Mapped[int] = mapped_column(Integer, nullable=False)
    next_review_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
