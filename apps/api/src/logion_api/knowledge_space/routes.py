from typing import Annotated, Any, Never
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, status

from logion_api.errors import ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    IdentityServiceDependency,
    SettingsDependency,
    require_trusted_origin,
)
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.errors import (
    deletion_disabled_error,
    knowledge_feature_disabled_error,
)
from logion_api.knowledge_space.schemas import (
    GRAPH_MAX_DEPTH,
    LIST_DEFAULT_PAGE_SIZE,
    LIST_MAX_PAGE_SIZE,
    CitationRelationship,
    Cursor,
    ExpectedVersionRequest,
    GraphDirection,
    GraphEdgeType,
    KnowledgeCitationCreateRequest,
    KnowledgeCitationPageResponse,
    KnowledgeCitationReplacementRequest,
    KnowledgeCitationResponse,
    KnowledgeDraftAcceptanceReceipt,
    KnowledgeDraftAcceptanceRequest,
    KnowledgeGraphResponse,
    KnowledgeTargetType,
    SourceExcerptCreateRequest,
    SourceExcerptPageResponse,
    SourceExcerptResponse,
)

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/knowledge",
    tags=["knowledge-space"],
)

CACHE_HEADER = {
    "Cache-Control": {
        "description": "Knowledge responses are private and must not be stored.",
        "schema": {"type": "string", "const": "private, no-store"},
    }
}
ERROR_RESPONSE = {"model": ErrorResponse, "headers": CACHE_HEADER}
ERRORS: dict[int | str, dict[str, Any]] = {
    code: ERROR_RESPONSE for code in (400, 401, 403, 404, 409, 422, 503)
}
ERRORS[429] = {
    "model": ErrorResponse,
    "headers": {
        **CACHE_HEADER,
        "Retry-After": {
            "description": "Seconds before the caller should retry.",
            "schema": {"type": "string"},
        },
    },
}
ETAG_HEADER = {
    "ETag": {
        "description": "Strong opaque entity validator. Clients must not parse it.",
        "schema": {"type": "string"},
    }
}
ITEM_RESPONSES = {
    **ERRORS,
    200: {"headers": {**CACHE_HEADER, **ETAG_HEADER}},
    304: {
        "description": "Not modified after current authorization was revalidated.",
        "headers": CACHE_HEADER,
    },
}
CREATE_RESPONSES = {**ERRORS, 201: {"headers": {**CACHE_HEADER, **ETAG_HEADER}}}

PageSize = Annotated[int, Query(ge=1, le=LIST_MAX_PAGE_SIZE)]
Depth = Annotated[int, Query(ge=1, le=GRAPH_MAX_DEPTH)]
CursorQuery = Annotated[Cursor | None, Query()]
IfMatch = Annotated[str | None, Header(min_length=2, max_length=256)]
IfNoneMatch = Annotated[str | None, Header(min_length=1, max_length=1024)]


async def require_read_boundary(
    context: AuthContextDependency,
    settings: SettingsDependency,
) -> AuthContext:
    if not settings.knowledge_space_api_enabled:
        raise knowledge_feature_disabled_error()
    return context


ReadBoundary = Annotated[AuthContext, Depends(require_read_boundary)]


async def require_mutation_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AuthContext:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    if not settings.knowledge_space_api_enabled:
        raise knowledge_feature_disabled_error()
    return context


MutationBoundary = Annotated[AuthContext, Depends(require_mutation_boundary)]


async def require_deletion_boundary(
    context: MutationBoundary,
    settings: SettingsDependency,
) -> AuthContext:
    if not settings.knowledge_space_deletion_enabled:
        raise deletion_disabled_error()
    return context


DeletionBoundary = Annotated[AuthContext, Depends(require_deletion_boundary)]


def _contract_not_wired() -> Never:
    # V20-04 publishes the approved contract but cannot activate a data path.
    # V20-08 must replace this fail-closed endpoint body with the authorized service.
    raise knowledge_feature_disabled_error()


@router.post(
    "/source-excerpts",
    response_model=SourceExcerptResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledge_source_excerpt_create",
    responses=CREATE_RESPONSES,
)
async def create_source_excerpt(
    workspace_id: UUID,
    space_id: UUID,
    payload: SourceExcerptCreateRequest,
    boundary: MutationBoundary,
) -> SourceExcerptResponse:
    _contract_not_wired()


@router.get(
    "/source-excerpts/{excerpt_id}",
    response_model=SourceExcerptResponse,
    operation_id="knowledge_source_excerpt_get",
    responses=ITEM_RESPONSES,
)
async def get_source_excerpt(
    workspace_id: UUID,
    space_id: UUID,
    excerpt_id: UUID,
    boundary: ReadBoundary,
    if_none_match: IfNoneMatch = None,
) -> SourceExcerptResponse:
    _contract_not_wired()


@router.get(
    "/source-excerpts",
    response_model=SourceExcerptPageResponse,
    operation_id="knowledge_source_excerpt_list",
    responses=ERRORS,
)
async def list_source_excerpts(
    workspace_id: UUID,
    space_id: UUID,
    boundary: ReadBoundary,
    page_size: PageSize = LIST_DEFAULT_PAGE_SIZE,
    cursor: CursorQuery = None,
    resource_id: UUID | None = None,
    stale: bool | None = None,
    status_filter: Annotated[str | None, Query(alias="status", max_length=32)] = None,
) -> SourceExcerptPageResponse:
    _contract_not_wired()


@router.post(
    "/source-excerpts/{excerpt_id}/deletion",
    response_model=SourceExcerptResponse,
    operation_id="knowledge_source_excerpt_delete",
    responses=ITEM_RESPONSES,
)
async def delete_source_excerpt(
    workspace_id: UUID,
    space_id: UUID,
    excerpt_id: UUID,
    payload: ExpectedVersionRequest,
    boundary: DeletionBoundary,
    if_match: IfMatch = None,
) -> SourceExcerptResponse:
    _contract_not_wired()


@router.post(
    "/knowledge-citations",
    response_model=KnowledgeCitationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledge_citation_create",
    responses=CREATE_RESPONSES,
)
async def create_knowledge_citation(
    workspace_id: UUID,
    space_id: UUID,
    payload: KnowledgeCitationCreateRequest,
    boundary: MutationBoundary,
) -> KnowledgeCitationResponse:
    _contract_not_wired()


@router.get(
    "/knowledge-citations/{citation_id}",
    response_model=KnowledgeCitationResponse,
    operation_id="knowledge_citation_get",
    responses=ITEM_RESPONSES,
)
async def get_knowledge_citation(
    workspace_id: UUID,
    space_id: UUID,
    citation_id: UUID,
    boundary: ReadBoundary,
    if_none_match: IfNoneMatch = None,
) -> KnowledgeCitationResponse:
    _contract_not_wired()


@router.get(
    "/knowledge-citations",
    response_model=KnowledgeCitationPageResponse,
    operation_id="knowledge_citation_list",
    responses=ERRORS,
)
async def list_knowledge_citations(
    workspace_id: UUID,
    space_id: UUID,
    boundary: ReadBoundary,
    page_size: PageSize = LIST_DEFAULT_PAGE_SIZE,
    cursor: CursorQuery = None,
    excerpt_id: UUID | None = None,
    topic_id: UUID | None = None,
    quiz_item_id: UUID | None = None,
    research_claim_id: UUID | None = None,
    note_id: UUID | None = None,
    relationship: CitationRelationship | None = None,
) -> KnowledgeCitationPageResponse:
    _contract_not_wired()


@router.post(
    "/knowledge-citations/{citation_id}/replacements",
    response_model=KnowledgeCitationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="knowledge_citation_replace",
    responses=CREATE_RESPONSES,
)
async def replace_knowledge_citation(
    workspace_id: UUID,
    space_id: UUID,
    citation_id: UUID,
    payload: KnowledgeCitationReplacementRequest,
    boundary: MutationBoundary,
    if_match: IfMatch = None,
) -> KnowledgeCitationResponse:
    _contract_not_wired()


@router.post(
    "/knowledge-citations/{citation_id}/deletion",
    response_model=KnowledgeCitationResponse,
    operation_id="knowledge_citation_delete",
    responses=ITEM_RESPONSES,
)
async def delete_knowledge_citation(
    workspace_id: UUID,
    space_id: UUID,
    citation_id: UUID,
    payload: ExpectedVersionRequest,
    boundary: DeletionBoundary,
    if_match: IfMatch = None,
) -> KnowledgeCitationResponse:
    _contract_not_wired()


@router.post(
    "/drafts/{draft_id}/acceptances",
    response_model=KnowledgeDraftAcceptanceReceipt,
    operation_id="knowledge_draft_accept",
    responses=ERRORS,
)
async def accept_knowledge_draft(
    workspace_id: UUID,
    space_id: UUID,
    draft_id: UUID,
    payload: KnowledgeDraftAcceptanceRequest,
    boundary: MutationBoundary,
    if_match: IfMatch = None,
) -> KnowledgeDraftAcceptanceReceipt:
    _contract_not_wired()


@router.get(
    "/graph",
    response_model=KnowledgeGraphResponse,
    operation_id="knowledge_graph_get",
    responses=ERRORS,
)
async def get_knowledge_graph(
    workspace_id: UUID,
    space_id: UUID,
    root_type: KnowledgeTargetType,
    root_id: UUID,
    boundary: ReadBoundary,
    depth: Depth = 1,
    direction: GraphDirection = GraphDirection.BOTH,
    edge_types: Annotated[list[GraphEdgeType] | None, Query(max_length=7)] = None,
    include_excerpt_preview: bool = False,
    cursor: CursorQuery = None,
) -> KnowledgeGraphResponse:
    _contract_not_wired()
