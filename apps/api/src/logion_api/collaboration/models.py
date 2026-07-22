from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
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


class SharedRecord:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Rubric(SharedRecord, Base):
    __tablename__ = "rubrics"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_rubric_scope"),
        Index("ix_rubric_space", "workspace_id", "space_id", "updated_at"),
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    criteria: Mapped[str] = mapped_column(Text, nullable=False)


class ReviewRequest(SharedRecord, Base):
    __tablename__ = "group_review_requests"
    __table_args__ = (
        ForeignKeyConstraint(
            ["rubric_id", "workspace_id", "space_id"],
            ["rubrics.id", "rubrics.workspace_id", "rubrics.space_id"],
            name="fk_group_review_rubric_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", "space_id", name="uq_group_review_scope"),
    )
    rubric_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    subject_title: Mapped[str] = mapped_column(String(240), nullable=False)
    submission_summary: Mapped[str] = mapped_column(Text, nullable=False)


class GroupFeedback(SharedRecord, Base):
    __tablename__ = "group_feedback"
    __table_args__ = (
        ForeignKeyConstraint(
            ["review_id", "workspace_id", "space_id"],
            [
                "group_review_requests.id",
                "group_review_requests.workspace_id",
                "group_review_requests.space_id",
            ],
            name="fk_group_feedback_review_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_group_feedback_workspace"),
    )
    review_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    feedback: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False, default="")


class ReportSnapshot(SharedRecord, Base):
    __tablename__ = "report_snapshots"
    __table_args__ = (
        ForeignKeyConstraint(
            ["review_id", "workspace_id", "space_id"],
            [
                "group_review_requests.id",
                "group_review_requests.workspace_id",
                "group_review_requests.space_id",
            ],
            name="fk_report_snapshot_review_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_report_snapshot_workspace"),
    )
    review_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
