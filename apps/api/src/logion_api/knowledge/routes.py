from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.form_drafts.service import consume as consume_form_draft
from logion_api.form_drafts.service import prepare_submission
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    SettingsDependency,
    request_id,
)
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.knowledge.schemas import EdgeCreate, EdgeDecision, EdgePage, EdgeView
from logion_api.knowledge.service import (
    edge_quota,
    identity_filter,
    new_edge,
    owned_edges,
    validate_endpoints,
    visible_edges,
)
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.service import not_found

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/knowledge/edges",
    tags=["research-knowledge"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


async def scope(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> None:
    await service.authorize(
        db, context, workspace_id, space_id, request_id(request), write=request.method != "GET"
    )


def audit(db: DatabaseSession, request: Request, user: UUID, action: str) -> None:
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"research.link_{action}",
            result="success",
            actor_id=user,
            target_type="knowledge_edge",
            metadata={},
        )
    )


@router.get(
    "", response_model=EdgePage, dependencies=[Depends(scope)], operation_id="knowledge_edge_list"
)
async def list_edges(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> EdgePage:
    query = visible_edges(workspace_id, space_id, context.user.id).where(
        KnowledgeEdge.status != "rejected"
    )
    if cursor is not None:
        query = query.where(KnowledgeEdge.id > cursor)
    rows = list(await db.scalars(query.order_by(KnowledgeEdge.id).limit(limit + 1)))
    return EdgePage(
        edges=[EdgeView.model_validate(row) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.post(
    "",
    response_model=EdgeView,
    status_code=201,
    dependencies=[Depends(prepare_submission), Depends(write_boundary), Depends(scope)],
    operation_id="knowledge_edge_create",
)
async def create_edge(
    workspace_id: UUID,
    space_id: UUID,
    payload: EdgeCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> EdgeView:
    await validate_endpoints(db, workspace_id, space_id, context.user.id, payload)
    existing = await db.scalar(
        owned_edges(workspace_id, space_id, context.user.id).where(identity_filter(payload))
    )
    if existing is not None:
        raise APIError(
            code="KNOWLEDGE_EDGE_EXISTS", message="This link already exists.", status_code=409
        )
    await edge_quota(db, workspace_id, context.user.id, 1, settings.research_entity_per_user_quota)
    edge = new_edge(workspace_id, space_id, context.user.id, payload)
    db.add(edge)
    await db.flush()
    audit(db, request, context.user.id, "created")
    response = EdgeView.model_validate(edge)
    await consume_form_draft(db)
    await db.commit()
    return response


@router.post(
    "/{edge_id}/decision",
    response_model=EdgeView,
    dependencies=[Depends(write_boundary), Depends(scope)],
    operation_id="knowledge_edge_decide",
)
async def decide_edge(
    workspace_id: UUID,
    space_id: UUID,
    edge_id: UUID,
    payload: EdgeDecision,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> EdgeView:
    edge = await db.scalar(
        visible_edges(workspace_id, space_id, context.user.id).where(KnowledgeEdge.id == edge_id)
    )
    if edge is None:
        raise not_found()
    if edge.version != payload.expected_version:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT", message="The link changed.", status_code=409
        )
    if edge.status == "rejected" or edge.status == payload.status:
        raise APIError(
            code="KNOWLEDGE_EDGE_TERMINAL", message="The link was already decided.", status_code=409
        )
    edge.status, edge.decided_at, edge.updated_at = payload.status, utc_now(), utc_now()
    edge.version += 1
    audit(db, request, context.user.id, payload.status)
    response = EdgeView.model_validate(edge)
    await db.commit()
    return response
