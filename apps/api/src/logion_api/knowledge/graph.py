"""Bounded, read-only projection of private links and existing topic prerequisites."""

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import and_, or_, select

from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.knowledge.routes import scope
from logion_api.knowledge.schemas import EdgeView, NodeKind
from logion_api.knowledge.service import NODE_MODELS, nodes, visible_edges
from logion_api.library.routes import require_enabled
from logion_api.library.service import not_found
from logion_api.memory.models import TopicDependency

MAX_NODES = 200
MAX_EDGES = 400
KINDS: tuple[NodeKind, ...] = ("question", "resource", "topic", "claim", "idea")


class NetworkNode(BaseModel):
    id: UUID
    kind: NodeKind
    title: str
    version: int
    personal: bool


class NetworkPrerequisite(BaseModel):
    id: UUID
    prerequisite_id: UUID
    dependent_id: UUID


class NetworkSnapshot(BaseModel):
    nodes: list[NetworkNode]
    edges: list[EdgeView]
    prerequisites: list[NetworkPrerequisite]
    truncated: bool


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/knowledge",
    tags=["research-knowledge"],
    dependencies=[Depends(require_enabled), Depends(scope)],
)


def endpoint_filter(identities: set[tuple[str, UUID]], side: str) -> Any:
    return or_(
        *(
            and_(
                getattr(KnowledgeEdge, f"{side}_type") == kind,
                getattr(KnowledgeEdge, f"{side}_id").in_(
                    [identity for node_kind, identity in identities if node_kind == kind]
                ),
            )
            for kind in KINDS
        )
    )


@router.get("/graph", response_model=NetworkSnapshot, operation_id="knowledge_network_read")
async def read_network(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    focus_type: Literal["question", "resource"] | None = None,
    focus_id: UUID | None = None,
) -> NetworkSnapshot:
    user = context.user.id
    if (focus_type is None) != (focus_id is None):
        raise not_found()
    base = visible_edges(workspace_id, space_id, user).where(KnowledgeEdge.status != "rejected")
    identities: set[tuple[str, UUID]] | None = None
    truncated = False
    if focus_type is not None and focus_id is not None:
        root = await db.scalar(
            nodes(focus_type, workspace_id, space_id, user).where(
                NODE_MODELS[focus_type].id == focus_id
            )
        )
        if root is None:
            raise not_found()
        identities = {(focus_type, focus_id)}
        # Two hops, each with a hard SQL bound; no recursive whole-library traversal.
        for _ in range(2):
            neighbors = list(
                await db.scalars(
                    base.where(
                        or_(endpoint_filter(identities, "from"), endpoint_filter(identities, "to"))
                    )
                    .order_by(KnowledgeEdge.id)
                    .limit(MAX_EDGES + 1)
                )
            )
            truncated |= len(neighbors) > MAX_EDGES
            for edge in neighbors[:MAX_EDGES]:
                identities.add((edge.from_type, edge.from_id))
                identities.add((edge.to_type, edge.to_id))
    groups: list[list[NetworkNode]] = []
    for kind in KINDS:
        model = NODE_MODELS[kind]
        query = nodes(kind, workspace_id, space_id, user)
        if identities is not None:
            query = query.where(model.id.in_([i for k, i in identities if k == kind]))
        rows = list(await db.scalars(query.order_by(model.id).limit(MAX_NODES + 1)))
        groups.append(
            [
                NetworkNode(
                    id=row.id,
                    kind=kind,
                    version=row.version,
                    title=getattr(
                        row, {"question": "question", "claim": "statement"}.get(kind, "title")
                    ),
                    personal=kind in {"question", "claim", "idea"} or row.research_owner_id == user,
                )
                for row in rows
            ]
        )
    # Round robin keeps a large paper library from displacing every other node type.
    result: list[NetworkNode] = []
    if focus_id is not None:
        for group in groups:
            for node in group[:]:
                if node.kind == focus_type and node.id == focus_id:
                    result.append(node)
                    group.remove(node)
    available = sum(len(group) for group in groups)
    truncated |= available + len(result) > MAX_NODES
    for index in range(MAX_NODES + 1):
        for group in groups:
            if index < len(group) and len(result) < MAX_NODES:
                result.append(group[index])
    selected: set[tuple[str, UUID]] = {(node.kind, node.id) for node in result}
    links = list(
        await db.scalars(
            base.where(endpoint_filter(selected, "from"), endpoint_filter(selected, "to"))
            .order_by(KnowledgeEdge.id)
            .limit(MAX_EDGES + 1)
        )
    )
    topic_ids = [node.id for node in result if node.kind == "topic"]
    remaining = MAX_EDGES - min(len(links), MAX_EDGES)
    prerequisites = list(
        await db.scalars(
            select(TopicDependency)
            .where(
                TopicDependency.workspace_id == workspace_id,
                TopicDependency.space_id == space_id,
                TopicDependency.deleted_at.is_(None),
                TopicDependency.prerequisite_topic_id.in_(topic_ids),
                TopicDependency.dependent_topic_id.in_(topic_ids),
            )
            .order_by(TopicDependency.id)
            .limit(remaining + 1)
        )
    )
    return NetworkSnapshot(
        nodes=result,
        edges=[EdgeView.model_validate(edge) for edge in links[:MAX_EDGES]],
        prerequisites=[
            NetworkPrerequisite(
                id=item.id,
                prerequisite_id=item.prerequisite_topic_id,
                dependent_id=item.dependent_topic_id,
            )
            for item in prerequisites[:remaining]
        ],
        truncated=truncated or len(links) > MAX_EDGES or len(prerequisites) > remaining,
    )
