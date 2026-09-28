from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Computed,
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


class KnowledgeEdge(Base):
    __tablename__ = "knowledge_edges"
    __table_args__ = (
        ForeignKeyConstraint(
            ["space_id", "workspace_id"],
            ["spaces.id", "spaces.workspace_id"],
            ondelete="CASCADE",
            name="fk_knowledge_edge_space",
        ),
        *(
            ForeignKeyConstraint(
                [column, "workspace_id", "space_id", *(["user_id"] if private else [])],
                [
                    f"{table}.id",
                    f"{table}.workspace_id",
                    f"{table}.space_id",
                    *([f"{table}.user_id"] if private else []),
                ],
                ondelete="RESTRICT" if column == "evidence_excerpt_id" else "CASCADE",
                name=f"fk_edge_{column[:-3]}_scope",
            )
            for column, table, private in (
                ("from_resource_id", "resources", False),
                ("from_claim_id", "research_claims", True),
                ("from_idea_id", "research_ideas", True),
                ("to_resource_id", "resources", False),
                ("to_topic_id", "topics", False),
                ("to_question_id", "research_questions", True),
                ("evidence_excerpt_id", "source_excerpts", False),
            )
        ),
        ForeignKeyConstraint(
            ["ai_run_id", "workspace_id"],
            ["ai_runs.id", "ai_runs.workspace_id"],
            ondelete="RESTRICT",
            name="fk_knowledge_edge_ai_run",
        ),
        CheckConstraint(
            "num_nonnulls(from_resource_id,from_claim_id,from_idea_id)=1 AND "
            "num_nonnulls(to_resource_id,to_topic_id,to_question_id)=1",
            name="ck_knowledge_edge_endpoints",
        ),
        CheckConstraint("from_type <> to_type OR from_id <> to_id", name="ck_edge_not_self"),
        CheckConstraint(
            "(from_type='resource' AND to_type='question' AND relation='addresses') OR "
            "(from_type='resource' AND to_type='topic' AND relation IN ('defines','uses')) OR "
            "(from_type='resource' AND to_type='resource' AND "
            "relation IN ('extends','contradicts','supersedes')) OR "
            "(from_type='claim' AND to_type='question' "
            "AND relation IN ('supports','challenges')) OR "
            "(from_type='idea' AND to_type='resource' AND relation='inspired_by')",
            name="ck_knowledge_edge_relation",
        ),
        CheckConstraint("status IN ('suggested','confirmed','rejected')", name="ck_edge_status"),
        CheckConstraint(
            "(origin='user' AND ai_run_id IS NULL AND status<>'suggested') OR "
            "(origin='ai' AND ai_run_id IS NOT NULL AND from_type<>'idea' AND to_type<>'idea')",
            name="ck_edge_origin",
        ),
        CheckConstraint(
            "version>=1 AND char_length(reason)<=1000 AND "
            "(origin<>'ai' OR char_length(btrim(reason))>0)",
            name="ck_edge_bounds",
        ),
        UniqueConstraint(
            "workspace_id",
            "space_id",
            "user_id",
            "from_type",
            "from_id",
            "to_type",
            "to_id",
            "relation",
            name="uq_knowledge_edge_identity",
        ),
        Index("ix_knowledge_edge_owner", "workspace_id", "space_id", "user_id", "id"),
        Index(
            "ix_knowledge_edge_from", "workspace_id", "space_id", "user_id", "from_type", "from_id"
        ),
        Index("ix_knowledge_edge_to", "workspace_id", "space_id", "user_id", "to_type", "to_id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    space_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    from_resource_id: Mapped[UUID | None] = mapped_column(Uuid)
    from_claim_id: Mapped[UUID | None] = mapped_column(Uuid)
    from_idea_id: Mapped[UUID | None] = mapped_column(Uuid)
    to_resource_id: Mapped[UUID | None] = mapped_column(Uuid)
    to_topic_id: Mapped[UUID | None] = mapped_column(Uuid)
    to_question_id: Mapped[UUID | None] = mapped_column(Uuid)
    from_type: Mapped[str] = mapped_column(
        String(16),
        Computed(
            "CASE WHEN from_resource_id IS NOT NULL THEN 'resource' "
            "WHEN from_claim_id IS NOT NULL THEN 'claim' ELSE 'idea' END",
            persisted=True,
        ),
    )
    from_id: Mapped[UUID] = mapped_column(
        Uuid,
        Computed(
            "COALESCE(from_resource_id,from_claim_id,from_idea_id)",
            persisted=True,
        ),
    )
    to_type: Mapped[str] = mapped_column(
        String(16),
        Computed(
            "CASE WHEN to_resource_id IS NOT NULL THEN 'resource' "
            "WHEN to_topic_id IS NOT NULL THEN 'topic' ELSE 'question' END",
            persisted=True,
        ),
    )
    to_id: Mapped[UUID] = mapped_column(
        Uuid,
        Computed(
            "COALESCE(to_resource_id,to_topic_id,to_question_id)",
            persisted=True,
        ),
    )
    relation: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    origin: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    evidence_excerpt_id: Mapped[UUID | None] = mapped_column(Uuid)
    ai_run_id: Mapped[UUID | None] = mapped_column(Uuid)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
