from datetime import datetime
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
