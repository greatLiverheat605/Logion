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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["goal_id", "workspace_id", "space_id"],
            ["learning_goals.id", "learning_goals.workspace_id", "learning_goals.space_id"],
            name="fk_task_goal_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["phase_id", "workspace_id"],
            ["plan_phases.id", "plan_phases.workspace_id"],
            name="fk_task_phase_workspace",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('backlog','planned','in_progress','submitted','verified','done',"
            "'blocked','cancelled')",
            name="ck_tasks_status",
        ),
        CheckConstraint("priority BETWEEN 0 AND 4", name="ck_tasks_priority"),
        CheckConstraint("estimated_minutes >= 0", name="ck_tasks_estimated_minutes"),
        UniqueConstraint("id", "workspace_id", name="uq_task_workspace"),
        Index("ix_tasks_workspace_status_due", "workspace_id", "status", "due_at"),
        Index("ix_tasks_goal_status", "goal_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    goal_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    phase_id: Mapped[UUID | None] = mapped_column(Uuid)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="backlog")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    planned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    blocked_reason: Mapped[str | None] = mapped_column(String(500))
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


class StudySession(Base):
    __tablename__ = "study_sessions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "workspace_id"],
            ["tasks.id", "tasks.workspace_id"],
            name="fk_study_session_task_workspace",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('active','completed','abandoned')", name="ck_study_sessions_status"
        ),
        CheckConstraint(
            "manual_minutes IS NULL OR manual_minutes BETWEEN 0 AND 1440",
            name="ck_study_sessions_manual_minutes",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_study_session_workspace"),
        Index(
            "uq_active_session_actor_workspace",
            "workspace_id",
            "created_by",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_study_sessions_task_started", "task_id", "started_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    manual_minutes: Mapped[int | None] = mapped_column(Integer)
    reflection: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SessionEvent(Base):
    __tablename__ = "session_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["session_id", "workspace_id"],
            ["study_sessions.id", "study_sessions.workspace_id"],
            name="fk_session_event_session_workspace",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "event_type IN ('started','completed','abandoned')",
            name="ck_session_events_type",
        ),
        CheckConstraint("jsonb_typeof(metadata) = 'object'", name="ck_session_event_metadata"),
        Index("ix_session_events_session_time", "session_id", "occurred_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    session_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    event_type: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    event_metadata: Mapped[dict[str, object]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
