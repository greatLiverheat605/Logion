from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class LearningGoal(Base):
    __tablename__ = "learning_goals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'active', 'completed', 'archived')",
            name="ck_learning_goals_status",
        ),
        CheckConstraint("weekly_minutes BETWEEN 0 AND 10080", name="ck_goal_weekly_minutes"),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_goal_scope"),
        Index("ix_learning_goals_space_status", "workspace_id", "space_id", "status"),
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
    desired_outcome: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    weekly_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    target_date: Mapped[date | None] = mapped_column(Date)
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


class LearningPlan(Base):
    __tablename__ = "learning_plans"
    __table_args__ = (
        ForeignKeyConstraint(
            ["goal_id", "workspace_id", "space_id"],
            ["learning_goals.id", "learning_goals.workspace_id", "learning_goals.space_id"],
            name="fk_learning_plan_goal_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('draft', 'active', 'archived')", name="ck_learning_plans_status"
        ),
        UniqueConstraint("goal_id", name="uq_learning_plan_goal"),
        UniqueConstraint("id", "workspace_id", name="uq_learning_plan_workspace"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    goal_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PlanVersion(Base):
    __tablename__ = "plan_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_id", "workspace_id"],
            ["learning_plans.id", "learning_plans.workspace_id"],
            name="fk_plan_version_plan_workspace",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'superseded')",
            name="ck_plan_versions_status",
        ),
        UniqueConstraint("plan_id", "version_number", name="uq_plan_version_number"),
        UniqueConstraint("id", "workspace_id", name="uq_plan_version_workspace"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    plan_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    change_summary: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PlanPhase(Base):
    __tablename__ = "plan_phases"
    __table_args__ = (
        ForeignKeyConstraint(
            ["plan_version_id", "workspace_id"],
            ["plan_versions.id", "plan_versions.workspace_id"],
            name="fk_plan_phase_version_workspace",
            ondelete="CASCADE",
        ),
        CheckConstraint("position >= 0", name="ck_plan_phases_position"),
        CheckConstraint("estimated_minutes >= 0", name="ck_plan_phases_estimated_minutes"),
        CheckConstraint("jsonb_typeof(acceptance_criteria) = 'array'", name="ck_phase_criteria"),
        UniqueConstraint("id", "workspace_id", name="uq_plan_phase_workspace"),
        UniqueConstraint("plan_version_id", "position", name="uq_plan_phase_position"),
        Index("ix_plan_phases_version_position", "plan_version_id", "position"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    plan_version_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    acceptance_criteria: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WeeklyReview(Base):
    __tablename__ = "weekly_reviews"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            name="fk_weekly_review_space",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["ai_comment_run_id", "workspace_id"],
            ["ai_runs.id", "ai_runs.workspace_id"],
            name="fk_weekly_review_run",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("user_id", "space_id", "week_start", name="uq_weekly_review_owner_week"),
        CheckConstraint("extract(isodow from week_start)=1", name="ck_weekly_review_monday"),
        CheckConstraint(
            "jsonb_typeof(stats)='object' AND jsonb_typeof(task_snapshot)='array' "
            "AND jsonb_typeof(triage)='array'",
            name="ck_weekly_review_json",
        ),
        CheckConstraint("version>=1", name="ck_weekly_review_version"),
        Index("ix_weekly_review_owner", "workspace_id", "space_id", "user_id", "week_start"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    stats: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False)
    task_snapshot: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    triage: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False, default=list)
    ai_comment_run_id: Mapped[UUID | None] = mapped_column(Uuid)
    ai_comment: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
