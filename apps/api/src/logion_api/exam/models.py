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
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class Exam(Base):
    __tablename__ = "exams"
    __table_args__ = (
        CheckConstraint(
            "date_status IN ('scheduled','undetermined')",
            name="ck_exam_date_status",
        ),
        CheckConstraint(
            "status IN ('planning','active','completed','archived')",
            name="ck_exam_status",
        ),
        CheckConstraint(
            "(date_status = 'scheduled' AND exam_at IS NOT NULL AND timezone IS NOT NULL) OR "
            "(date_status = 'undetermined' AND exam_at IS NULL)",
            name="ck_exam_date_shape",
        ),
        CheckConstraint(
            "(target_score IS NULL AND score_scale_max IS NULL) OR "
            "(target_score BETWEEN 0 AND score_scale_max "
            "AND score_scale_max BETWEEN 1 AND 1000000)",
            name="ck_exam_target_score",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_exam_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_exam_personal_scope"
        ),
        Index("ix_exam_user_date", "workspace_id", "user_id", "exam_at"),
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
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    date_status: Mapped[str] = mapped_column(String(20), nullable=False)
    exam_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    timezone: Mapped[str | None] = mapped_column(String(64))
    target_score: Mapped[int | None] = mapped_column(Integer)
    score_scale_max: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="planning")
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


class Subject(Base):
    __tablename__ = "exam_subjects"
    __table_args__ = (
        ForeignKeyConstraint(
            ["exam_id", "workspace_id", "space_id", "user_id"],
            ["exams.id", "exams.workspace_id", "exams.space_id", "exams.user_id"],
            name="fk_exam_subject_exam_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "weight_basis_points BETWEEN 0 AND 10000",
            name="ck_exam_subject_weight",
        ),
        CheckConstraint("status IN ('active','archived')", name="ck_exam_subject_status"),
        UniqueConstraint("id", "workspace_id", name="uq_exam_subject_workspace"),
        UniqueConstraint("id", "workspace_id", "space_id", "user_id", name="uq_exam_subject_scope"),
        UniqueConstraint("exam_id", "user_id", "name", name="uq_exam_subject_name"),
        Index("ix_exam_subject_user_exam", "workspace_id", "user_id", "exam_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    exam_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    weight_basis_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyllabusNode(Base):
    __tablename__ = "syllabus_nodes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["subject_id", "workspace_id", "space_id", "user_id"],
            [
                "exam_subjects.id",
                "exam_subjects.workspace_id",
                "exam_subjects.space_id",
                "exam_subjects.user_id",
            ],
            name="fk_syllabus_node_subject_scope",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["parent_id", "subject_id", "workspace_id", "space_id", "user_id"],
            [
                "syllabus_nodes.id",
                "syllabus_nodes.subject_id",
                "syllabus_nodes.workspace_id",
                "syllabus_nodes.space_id",
                "syllabus_nodes.user_id",
            ],
            name="fk_syllabus_node_parent_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="ck_syllabus_node_not_self"),
        CheckConstraint("importance BETWEEN 1 AND 5", name="ck_syllabus_node_importance"),
        CheckConstraint(
            "coverage_status IN ('not_started','in_progress','covered')",
            name="ck_syllabus_node_coverage",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_syllabus_node_workspace"),
        UniqueConstraint(
            "id",
            "subject_id",
            "workspace_id",
            "space_id",
            "user_id",
            name="uq_syllabus_node_scope",
        ),
        Index("ix_syllabus_node_subject", "workspace_id", "user_id", "subject_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    subject_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    parent_id: Mapped[UUID | None] = mapped_column(Uuid)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(240), nullable=False)
    importance: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    coverage_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_started")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
