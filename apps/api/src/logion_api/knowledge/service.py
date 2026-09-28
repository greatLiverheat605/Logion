from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.knowledge.schemas import EdgeCreate
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.library.service import not_found
from logion_api.memory.models import Topic
from logion_api.research.models import ResearchClaim, ResearchIdea, ResearchQuestion

NODE_MODELS: dict[str, Any] = {
    "resource": Resource,
    "question": ResearchQuestion,
    "topic": Topic,
    "claim": ResearchClaim,
    "idea": ResearchIdea,
}


def nodes(kind: str, workspace: UUID, space: UUID, user: UUID) -> Select[Any]:
    model = NODE_MODELS[kind]
    query = select(model).where(
        model.workspace_id == workspace,
        model.space_id == space,
        model.deleted_at.is_(None),
    )
    if kind in {"question", "claim", "idea"}:
        return query.where(model.user_id == user)
    return query.where(model.research_owner_id.is_(None) | (model.research_owner_id == user))


def excerpts(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[SourceExcerpt]]:
    return (
        select(SourceExcerpt)
        .join(Resource, Resource.id == SourceExcerpt.resource_id)
        .where(
            SourceExcerpt.workspace_id == workspace,
            SourceExcerpt.space_id == space,
            SourceExcerpt.deleted_at.is_(None),
            SourceExcerpt.status == "active",
            Resource.deleted_at.is_(None),
            Resource.research_owner_id.is_(None) | (Resource.research_owner_id == user),
        )
    )


def owned_edges(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[KnowledgeEdge]]:
    return select(KnowledgeEdge).where(
        KnowledgeEdge.workspace_id == workspace,
        KnowledgeEdge.space_id == space,
        KnowledgeEdge.user_id == user,
    )


def visible_edges(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[KnowledgeEdge]]:
    query = owned_edges(workspace, space, user)
    for side, kinds in (
        ("from", ("resource", "claim", "idea")),
        ("to", ("resource", "topic", "question")),
    ):
        query = query.where(
            or_(
                *(
                    and_(
                        getattr(KnowledgeEdge, f"{side}_type") == kind,
                        getattr(KnowledgeEdge, f"{side}_id").in_(
                            nodes(kind, workspace, space, user).with_only_columns(
                                NODE_MODELS[kind].id
                            )
                        ),
                    )
                    for kind in kinds
                )
            )
        )
    # Recheck excerpt ownership too, even when a shared source changes visibility.
    return query.where(
        KnowledgeEdge.evidence_excerpt_id.is_(None)
        | KnowledgeEdge.evidence_excerpt_id.in_(
            excerpts(workspace, space, user).with_only_columns(SourceExcerpt.id)
        )
    )


async def validate_endpoints(
    db: AsyncSession,
    workspace: UUID,
    space: UUID,
    user: UUID,
    fields: EdgeCreate,
) -> None:
    for kind, identity in ((fields.from_type, fields.from_id), (fields.to_type, fields.to_id)):
        if (
            await db.scalar(
                nodes(kind, workspace, space, user).where(NODE_MODELS[kind].id == identity)
            )
            is None
        ):
            raise not_found()
    if (
        fields.evidence_excerpt_id is not None
        and await db.scalar(
            excerpts(workspace, space, user).where(SourceExcerpt.id == fields.evidence_excerpt_id)
        )
        is None
    ):
        raise not_found()


def identity_filter(fields: EdgeCreate) -> Any:
    return and_(
        KnowledgeEdge.from_type == fields.from_type,
        KnowledgeEdge.from_id == fields.from_id,
        KnowledgeEdge.to_type == fields.to_type,
        KnowledgeEdge.to_id == fields.to_id,
        KnowledgeEdge.relation == fields.relation,
    )


async def edge_quota(
    db: AsyncSession, workspace: UUID, user: UUID, additional: int, maximum: int
) -> None:
    count = await db.scalar(
        select(func.count())
        .select_from(KnowledgeEdge)
        .where(
            KnowledgeEdge.workspace_id == workspace,
            KnowledgeEdge.user_id == user,
        )
    )
    if (count or 0) + additional > maximum:
        raise APIError(
            code="RESOURCE_QUOTA_EXCEEDED", message="Link limit reached.", status_code=409
        )


def new_edge(
    workspace: UUID,
    space: UUID,
    user: UUID,
    fields: EdgeCreate,
    *,
    run_id: UUID | None = None,
) -> KnowledgeEdge:
    return KnowledgeEdge(
        workspace_id=workspace,
        space_id=space,
        user_id=user,
        **{f"from_{fields.from_type}_id": fields.from_id, f"to_{fields.to_type}_id": fields.to_id},
        relation=fields.relation,
        reason=fields.reason,
        evidence_excerpt_id=fields.evidence_excerpt_id,
        origin="ai" if run_id else "user",
        status="suggested" if run_id else "confirmed",
        ai_run_id=run_id,
        decided_at=None if run_id else utc_now(),
    )
