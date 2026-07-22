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


class PersonalRecord:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LearningTrack(PersonalRecord, Base):
    __tablename__ = "learning_tracks"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_learning_track_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_learning_track_scope"
        ),
        Index("ix_learning_track_user", "workspace_id", "user_id", "updated_at"),
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False, default="")


class StudyProject(PersonalRecord, Base):
    __tablename__ = "study_projects"
    __table_args__ = (
        ForeignKeyConstraint(
            ["track_id", "workspace_id", "space_id", "user_id"],
            [
                "learning_tracks.id",
                "learning_tracks.workspace_id",
                "learning_tracks.space_id",
                "learning_tracks.user_id",
            ],
            name="fk_study_project_track_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_study_project_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_study_project_scope"
        ),
        Index("ix_study_project_track", "workspace_id", "user_id", "track_id"),
    )
    track_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    intended_outcome: Mapped[str] = mapped_column(Text, nullable=False)


class InboxItem(PersonalRecord, Base):
    __tablename__ = "inbox_items"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_inbox_item_workspace"),
        Index("ix_inbox_item_user", "workspace_id", "user_id", "created_at"),
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Deliverable(PersonalRecord, Base):
    __tablename__ = "deliverables"
    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "workspace_id", "space_id", "user_id"],
            [
                "study_projects.id",
                "study_projects.workspace_id",
                "study_projects.space_id",
                "study_projects.user_id",
            ],
            name="fk_deliverable_project_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_deliverable_workspace"),
        Index("ix_deliverable_project", "workspace_id", "user_id", "project_id"),
    )
    project_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    evidence_summary: Mapped[str] = mapped_column(Text, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
