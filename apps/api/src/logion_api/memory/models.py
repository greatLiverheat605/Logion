from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
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
            "source IN ('mastery_confirmation','manual','quiz_error')",
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


class QuizItem(Base):
    __tablename__ = "quiz_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_quiz_item_topic_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "evaluation_mode IN ('exact_match','self_assessed')",
            name="ck_quiz_item_evaluation_mode",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_quiz_item_workspace"),
        Index("ix_quiz_items_topic_updated", "workspace_id", "topic_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    answer_key: Mapped[str] = mapped_column(Text, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evaluation_mode: Mapped[str] = mapped_column(String(20), nullable=False)
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


class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    __table_args__ = (
        ForeignKeyConstraint(
            ["quiz_item_id", "workspace_id"],
            ["quiz_items.id", "quiz_items.workspace_id"],
            name="fk_quiz_attempt_item_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_quiz_attempt_topic_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint("confidence BETWEEN 1 AND 5", name="ck_quiz_attempt_confidence"),
        CheckConstraint("duration_seconds BETWEEN 0 AND 86400", name="ck_quiz_attempt_duration"),
        CheckConstraint(
            "error_cause IS NULL OR error_cause IN "
            "('recall_gap','concept_confusion','misread','careless','application_gap','unknown')",
            name="ck_quiz_attempt_error_cause",
        ),
        CheckConstraint(
            "is_correct = FALSE OR error_cause IS NULL",
            name="ck_quiz_attempt_correct_has_no_error",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_quiz_attempt_workspace"),
        Index(
            "ix_quiz_attempt_user_time",
            "workspace_id",
            "user_id",
            "attempted_at",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    quiz_item_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    response_text: Mapped[str] = mapped_column(Text, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    error_cause: Mapped[str | None] = mapped_column(String(24))
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
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


class ErrorPattern(Base):
    __tablename__ = "error_patterns"
    __table_args__ = (
        ForeignKeyConstraint(
            ["topic_id", "workspace_id", "space_id"],
            ["topics.id", "topics.workspace_id", "topics.space_id"],
            name="fk_error_pattern_topic_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["latest_attempt_id", "workspace_id"],
            ["quiz_attempts.id", "quiz_attempts.workspace_id"],
            name="fk_error_pattern_latest_attempt_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "cause IN "
            "('recall_gap','concept_confusion','misread','careless','application_gap','unknown')",
            name="ck_error_pattern_cause",
        ),
        CheckConstraint("status IN ('open','resolved')", name="ck_error_pattern_status"),
        CheckConstraint("occurrence_count >= 1", name="ck_error_pattern_count"),
        UniqueConstraint(
            "workspace_id", "topic_id", "user_id", "cause", name="uq_error_pattern_user_topic"
        ),
        UniqueConstraint("id", "workspace_id", name="uq_error_pattern_workspace"),
        Index("ix_error_pattern_user_status", "workspace_id", "user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    topic_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cause: Mapped[str] = mapped_column(String(24), nullable=False)
    occurrence_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    latest_attempt_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
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


class AuditReview(Base):
    __tablename__ = "audit_reviews"
    __table_args__ = (
        CheckConstraint("cadence IN ('daily','weekly')", name="ck_audit_review_cadence"),
        CheckConstraint("status IN ('draft','completed')", name="ck_audit_review_status"),
        CheckConstraint("period_start <= period_end", name="ck_audit_review_period"),
        CheckConstraint(
            "(status = 'draft' AND completed_by IS NULL AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_audit_review_completion_shape",
        ),
        UniqueConstraint(
            "workspace_id",
            "space_id",
            "user_id",
            "cadence",
            "period_start",
            "period_end",
            name="uq_audit_review_period",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_audit_review_workspace"),
        Index("ix_audit_review_user_period", "workspace_id", "user_id", "period_end"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    space_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    cadence: Mapped[str] = mapped_column(String(12), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    completed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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


class ReviewFinding(Base):
    __tablename__ = "review_findings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["audit_review_id", "workspace_id"],
            ["audit_reviews.id", "audit_reviews.workspace_id"],
            name="fk_review_finding_review_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "category IN ('progress','blocker','adjustment','error_pattern')",
            name="ck_review_finding_category",
        ),
        CheckConstraint("status IN ('open','resolved')", name="ck_review_finding_status"),
        UniqueConstraint("id", "workspace_id", name="uq_review_finding_workspace"),
        Index("ix_review_finding_user_status", "workspace_id", "user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    audit_review_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_action: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
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
