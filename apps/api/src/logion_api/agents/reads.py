"""Agent projections reuse the research context whitelist and field selection."""

import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from logion_api.agents.schemas import AgentEntity, AgentEntityPage
from logion_api.agents.security import AgentDatabase, Token, require_read
from logion_api.ai_gateway.research_context import (
    AI_CONTEXT_ENTITY_TYPES,
    CONTEXT_MODELS,
    ContextEntity,
    build_research_context,
)
from logion_api.content.models import Resource
from logion_api.errors import APIError
from logion_api.knowledge.service import nodes
from logion_api.library.service import not_found
from logion_api.memory.models import Topic
from logion_api.research.models import ResearchQuestion

router = APIRouter(prefix="/api/v1/agent", tags=["agent"], dependencies=[Depends(require_read)])


async def entity(
    db: AgentDatabase, token: Token, kind: str, identity: UUID, version: int
) -> AgentEntity:
    fields = await build_research_context(
        db,
        workspace_id=token.workspace_id,
        space_id=token.space_id,
        user_id=token.user_id,
        task_type="explain",
        entities=[ContextEntity(entity_type=kind, id=identity, version=version)],
    )
    value = json.loads(fields["source_0"])
    return AgentEntity.model_validate(
        {"entity_type": kind, "id": identity, "version": version, "data": value["data"]}
    )


def bounded(page: AgentEntityPage) -> AgentEntityPage:
    if len(page.model_dump_json().encode()) > 512 * 1024:
        raise APIError(
            code="AGENT_OUTPUT_TOO_LARGE", message="Use a smaller page size.", status_code=422
        )
    return page


@router.get("/resources", response_model=AgentEntityPage, operation_id="agent_search_resources")
async def resources(
    db: AgentDatabase,
    token: Token,
    q: Annotated[str, Query(max_length=200)] = "",
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> AgentEntityPage:
    query = nodes("resource", token.workspace_id, token.space_id, token.user_id).with_only_columns(
        Resource.id, Resource.version
    )
    if q:
        query = query.where(
            or_(
                Resource.title.icontains(q, autoescape=True),
                Resource.doi.icontains(q, autoescape=True),
                Resource.arxiv_id.icontains(q, autoescape=True),
            )
        )
    if cursor:
        query = query.where(Resource.id > cursor)
    rows = (await db.execute(query.order_by(Resource.id).limit(limit + 1))).all()
    return bounded(
        AgentEntityPage(
            items=[
                await entity(db, token, "resource", row.id, row.version) for row in rows[:limit]
            ],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )
    )


@router.get(
    "/entities/{entity_type}", response_model=AgentEntityPage, operation_id="agent_list_concepts"
)
async def concepts(
    entity_type: str,
    db: AgentDatabase,
    token: Token,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> AgentEntityPage:
    if entity_type not in {"research_question", "topic"}:
        raise APIError(
            code="AGENT_CONTEXT_TYPE_BLOCKED",
            message="Entity type is not permitted.",
            status_code=403,
        )
    model: Any = ResearchQuestion if entity_type == "research_question" else Topic
    query = nodes(
        "question" if entity_type == "research_question" else "topic",
        token.workspace_id,
        token.space_id,
        token.user_id,
    ).with_only_columns(model.id, model.version)
    if cursor:
        query = query.where(model.id > cursor)
    rows = (await db.execute(query.order_by(model.id).limit(limit + 1))).all()
    return bounded(
        AgentEntityPage(
            items=[
                await entity(db, token, entity_type, row.id, row.version) for row in rows[:limit]
            ],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )
    )


@router.get(
    "/entities/{entity_type}/{entity_id}",
    response_model=AgentEntity,
    operation_id="agent_read_entity",
)
async def read_entity(
    entity_type: str, entity_id: UUID, db: AgentDatabase, token: Token
) -> AgentEntity:
    if entity_type not in AI_CONTEXT_ENTITY_TYPES:
        raise APIError(
            code="AGENT_CONTEXT_TYPE_BLOCKED",
            message="Entity type is not permitted.",
            status_code=403,
        )
    model: Any = CONTEXT_MODELS[entity_type]
    version = await db.scalar(
        select(model.version).where(
            model.id == entity_id,
            model.workspace_id == token.workspace_id,
            model.space_id == token.space_id,
            model.deleted_at.is_(None),
        )
    )
    if version is None:
        raise not_found()
    return await entity(db, token, entity_type, entity_id, version)


@router.get(
    "/resources/{resource_id}/excerpts",
    response_model=AgentEntityPage,
    operation_id="agent_read_excerpts",
)
async def read_excerpts(
    resource_id: UUID,
    db: AgentDatabase,
    token: Token,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 20,
) -> AgentEntityPage:
    from logion_api.knowledge.service import excerpts
    from logion_api.knowledge_space.models import SourceExcerpt

    await read_entity("resource", resource_id, db, token)
    query = (
        excerpts(token.workspace_id, token.space_id, token.user_id)
        .where(SourceExcerpt.resource_id == resource_id)
        .with_only_columns(SourceExcerpt.id, SourceExcerpt.version)
    )
    if cursor:
        query = query.where(SourceExcerpt.id > cursor)
    rows = (await db.execute(query.order_by(SourceExcerpt.id).limit(limit + 1))).all()
    return bounded(
        AgentEntityPage(
            items=[
                await entity(db, token, "source_excerpt", row.id, row.version)
                for row in rows[:limit]
            ],
            next_cursor=rows[limit - 1].id if len(rows) > limit else None,
        )
    )
