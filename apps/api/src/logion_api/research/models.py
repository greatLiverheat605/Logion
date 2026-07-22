from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Float,
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


class PersonalResearch:
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


class PaperRecord(PersonalResearch, Base):
    __tablename__ = "paper_records"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_paper_record_workspace"),
        UniqueConstraint("id", "workspace_id", "space_id", "user_id", name="uq_paper_record_scope"),
        Index("ix_paper_record_user", "workspace_id", "user_id", "updated_at"),
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    citation_key: Mapped[str] = mapped_column(String(160), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(2000))


class ResearchClaim(PersonalResearch, Base):
    __tablename__ = "research_claims"
    __table_args__ = (
        ForeignKeyConstraint(
            ["paper_id", "workspace_id", "space_id", "user_id"],
            [
                "paper_records.id",
                "paper_records.workspace_id",
                "paper_records.space_id",
                "paper_records.user_id",
            ],
            name="fk_research_claim_paper_scope",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "stance IN ('supports','opposes','mixed','unknown')", name="ck_research_claim_stance"
        ),
        UniqueConstraint("id", "workspace_id", name="uq_research_claim_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_research_claim_scope"
        ),
    )
    paper_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    statement: Mapped[str] = mapped_column(Text, nullable=False)
    stance: Mapped[str] = mapped_column(String(16), nullable=False)


class ResearchQuestion(PersonalResearch, Base):
    __tablename__ = "research_questions"
    __table_args__ = (
        UniqueConstraint("id", "workspace_id", name="uq_research_question_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_research_question_scope"
        ),
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")


class ExperimentRun(PersonalResearch, Base):
    __tablename__ = "experiment_runs"
    __table_args__ = (
        ForeignKeyConstraint(
            ["question_id", "workspace_id", "space_id", "user_id"],
            [
                "research_questions.id",
                "research_questions.workspace_id",
                "research_questions.space_id",
                "research_questions.user_id",
            ],
            name="fk_experiment_run_question_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_experiment_run_workspace"),
        UniqueConstraint(
            "id", "workspace_id", "space_id", "user_id", name="uq_experiment_run_scope"
        ),
    )
    question_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    method_summary: Mapped[str] = mapped_column(Text, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MetricRecord(PersonalResearch, Base):
    __tablename__ = "metric_records"
    __table_args__ = (
        ForeignKeyConstraint(
            ["run_id", "workspace_id", "space_id", "user_id"],
            [
                "experiment_runs.id",
                "experiment_runs.workspace_id",
                "experiment_runs.space_id",
                "experiment_runs.user_id",
            ],
            name="fk_metric_record_run_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_metric_record_workspace"),
    )
    run_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(80), nullable=False, default="")


class ResearchFeedback(PersonalResearch, Base):
    __tablename__ = "research_feedback"
    __table_args__ = (
        ForeignKeyConstraint(
            ["claim_id", "workspace_id", "space_id", "user_id"],
            [
                "research_claims.id",
                "research_claims.workspace_id",
                "research_claims.space_id",
                "research_claims.user_id",
            ],
            name="fk_research_feedback_claim_scope",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "workspace_id", name="uq_research_feedback_workspace"),
    )
    claim_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    requested_action: Mapped[str] = mapped_column(Text, nullable=False, default="")
