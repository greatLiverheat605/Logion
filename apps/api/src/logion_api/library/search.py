"""Read-only, bounded research search. Never traverses ideas or knowledge edges."""

import asyncio
import unicodedata
from datetime import timedelta
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import (
    Integer,
    Text,
    Uuid,
    and_,
    cast,
    func,
    literal,
    or_,
    select,
    tuple_,
    union_all,
)

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    request_id,
)
from logion_api.knowledge_space.cursors import KnowledgeCursorCodec, KnowledgeCursorScope
from logion_api.knowledge_space.errors import query_timeout_error
from logion_api.knowledge_space.limits import (
    ITEM_READ_RATE,
    LIST_STATEMENT_TIMEOUT_SECONDS,
    enforce_dual_rate_limit,
)
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.library.routes import Service, require_enabled
from logion_api.library.service import not_found
from logion_api.library.text_models import SourceText
from logion_api.memory.models import QuizItem, Topic

SearchKind = Literal["resource", "text", "excerpt", "topic", "quiz"]


class ResearchSearchItem(BaseModel):
    kind: SearchKind
    id: UUID
    title: str
    snippet: str
    resource_id: UUID | None
    topic_id: UUID | None
    page: int | None
    personal: bool


class ResearchSearchPage(BaseModel):
    items: list[ResearchSearchItem]
    next_cursor: str | None


class ResearchSearchConcept(BaseModel):
    id: UUID
    title: str
    description: str


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/search",
    tags=["research-search"],
    dependencies=[Depends(require_enabled)],
)


def normalize_query(value: str) -> str:
    value = unicodedata.normalize("NFC", value).strip()
    if not 2 <= len(value) <= 120 or any(unicodedata.category(c) == "Cc" for c in value):
        raise APIError(
            code="SEARCH_QUERY_INVALID", message="Use 2–120 printable characters.", status_code=422
        )
    return value


def topic_scope(workspace: UUID, space: UUID, user: UUID) -> Any:
    return and_(
        Topic.workspace_id == workspace,
        Topic.space_id == space,
        Topic.deleted_at.is_(None),
        or_(Topic.research_owner_id.is_(None), Topic.research_owner_id == user),
    )


async def boundary(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    limiter: RateLimiterDependency,
) -> None:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    await enforce_dual_rate_limit(
        limiter,
        get_security(),
        operation="research_search",
        caller_id=str(context.user.id),
        workspace_id=str(workspace_id),
        policy=ITEM_READ_RATE,
    )


@router.get(
    "/concepts/{topic_id}",
    response_model=ResearchSearchConcept,
    operation_id="research_search_concept",
    dependencies=[Depends(boundary)],
)
async def concept(
    workspace_id: UUID,
    space_id: UUID,
    topic_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> ResearchSearchConcept:
    row = await db.scalar(
        select(Topic).where(
            topic_scope(workspace_id, space_id, context.user.id), Topic.id == topic_id
        )
    )
    if row is None:
        raise not_found()
    return ResearchSearchConcept(id=row.id, title=row.title, description=row.description)


@router.get(
    "",
    response_model=ResearchSearchPage,
    operation_id="research_search",
    dependencies=[Depends(boundary)],
)
async def search(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
    q: Annotated[str, Query(min_length=2, max_length=120)],
    kind: SearchKind | None = None,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> ResearchSearchPage:
    query_text = normalize_query(q)
    active = settings.knowledge_cursor_active_key_id
    if active is None or active not in settings.knowledge_cursor_keys:
        raise APIError(
            code="SEARCH_CURSOR_UNAVAILABLE",
            message="Search cursor signing is not configured.",
            status_code=503,
        )
    codec = KnowledgeCursorCodec(
        active_key_id=active,
        previous_key_id=settings.knowledge_cursor_previous_key_id,
        keys={
            k: v.get_secret_value().encode("utf-8")
            for k, v in settings.knowledge_cursor_keys.items()
        },
        lifetime=timedelta(seconds=settings.knowledge_cursor_ttl_seconds),
        clock_skew=timedelta(seconds=settings.knowledge_cursor_clock_skew_seconds),
    )
    scope = KnowledgeCursorScope(
        subject_hash=get_security().privacy_hash(f"research-search:{context.user.id}") or "unknown",
        workspace_id=str(workspace_id),
        space_id=str(space_id),
        endpoint="research-search",
    )
    filters = {"q": query_text, "kind": kind, "limit": limit}
    cutoff, position = utc_now(), None
    if cursor:
        decoded = codec.decode(cursor, scope=scope, filters=filters)
        cutoff, position = decoded.cutoff_at, decoded.position
        try:
            if set(position) != {"kind", "id"} or position["kind"] not in {
                "resource",
                "text",
                "excerpt",
                "topic",
                "quiz",
            }:
                raise ValueError
            after_kind, after_id = str(position["kind"]), UUID(str(position["id"]))
        except ValueError as exc:
            raise codec.invalid_cursor() from exc

    user = context.user.id
    resource_scope = and_(
        Resource.workspace_id == workspace_id,
        Resource.space_id == space_id,
        Resource.research_owner_id == user,
        Resource.deleted_at.is_(None),
        Resource.updated_at <= cutoff,
    )
    topics = topic_scope(workspace_id, space_id, user)
    empty_id, empty_page = cast(literal(None), Uuid), cast(literal(None), Integer)

    # PostgreSQL NFC + literal strpos means %, _ and backslash are ordinary text.
    def normalized(value: Any) -> Any:
        return func.lower(func.normalize(value))

    def match_at(value: Any) -> Any:
        return func.strpos(normalized(value), func.lower(literal(query_text)))

    def projection(
        kind: str,
        model: Any,
        title: Any,
        body: Any,
        resource: Any = empty_id,
        topic: Any = empty_id,
        page: Any = empty_page,
        personal: Any = None,
    ) -> Any:
        return select(
            literal(kind).label("kind"),
            model.id.label("id"),
            func.substr(title, 1, 300).label("title"),
            func.substr(func.normalize(body), func.greatest(1, match_at(body) - 60), 240).label(
                "snippet"
            ),
            resource.label("resource_id"),
            topic.label("topic_id"),
            page.label("page"),
            (literal(True) if personal is None else personal).label("personal"),
        ).where(match_at(body) > 0, model.created_at <= cutoff)

    metadata = func.concat_ws(
        " ",
        Resource.title,
        Resource.doi,
        Resource.arxiv_id,
        Resource.pmid,
        Resource.citation_key,
        cast(Resource.csl, Text),
        cast(Resource.tags, Text),
    )
    resource_query = projection("resource", Resource, Resource.title, metadata, Resource.id).where(
        resource_scope
    )
    text_candidates = (
        projection("text", SourceText, Resource.title, SourceText.text, Resource.id)
        .add_columns((match_at(SourceText.text) - 1).label("offset"), SourceText.page_offsets)
        .join(
            Resource,
            and_(
                Resource.id == SourceText.resource_id,
                Resource.workspace_id == SourceText.workspace_id,
                Resource.space_id == SourceText.space_id,
            ),
        )
        .where(
            resource_scope,
            SourceText.deleted_at.is_(None),
            SourceText.file_sha256 == Resource.sha256,
        )
    )
    if position:
        text_candidates = text_candidates.where(
            tuple_(literal("text"), SourceText.id) > (after_kind, after_id)
        )
    # Calculate the hit once per selected document, not once per JSON page offset.
    hits = (
        text_candidates.order_by(SourceText.id)
        .limit(limit + 1)
        .cte("text_hits")
        .prefix_with("MATERIALIZED")
    )
    pages = (
        func.jsonb_array_elements(hits.c.page_offsets)
        .table_valued("value", with_ordinality="number")
        .render_derived()
    )
    text_page = (
        select(cast(pages.c.number, Integer))
        .where(
            cast(pages.c.value.op("->>")("start"), Integer) <= hits.c.offset,
            cast(pages.c.value.op("->>")("end"), Integer) > hits.c.offset,
        )
        .order_by(pages.c.number)
        .limit(1)
        .correlate(hits)
        .scalar_subquery()
    )
    text_query = select(
        hits.c.kind,
        hits.c.id,
        hits.c.title,
        hits.c.snippet,
        hits.c.resource_id,
        hits.c.topic_id,
        text_page.label("page"),
        hits.c.personal,
    )
    excerpt_query = (
        projection(
            "excerpt",
            SourceExcerpt,
            Resource.title,
            SourceExcerpt.excerpt_text,
            Resource.id,
            page=SourceExcerpt.page_start,
        )
        .join(
            Resource,
            and_(
                Resource.id == SourceExcerpt.resource_id,
                Resource.workspace_id == SourceExcerpt.workspace_id,
                Resource.space_id == SourceExcerpt.space_id,
            ),
        )
        .where(
            resource_scope,
            SourceExcerpt.deleted_at.is_(None),
            SourceExcerpt.status == "active",
            SourceExcerpt.updated_at <= cutoff,
        )
    )
    topic_query = projection(
        "topic",
        Topic,
        Topic.title,
        func.concat_ws(" ", Topic.title, Topic.description),
        topic=Topic.id,
        personal=Topic.research_owner_id.is_not(None),
    ).where(topics, Topic.updated_at <= cutoff)
    quiz_query = (
        projection(
            "quiz",
            QuizItem,
            Topic.title,
            QuizItem.prompt,
            QuizItem.resource_id,
            Topic.id,
            personal=QuizItem.research_owner_id.is_not(None),
        )
        .join(
            Topic,
            and_(
                Topic.id == QuizItem.topic_id,
                Topic.workspace_id == QuizItem.workspace_id,
                Topic.space_id == QuizItem.space_id,
            ),
        )
        .outerjoin(
            Resource,
            and_(
                Resource.id == QuizItem.resource_id,
                Resource.workspace_id == QuizItem.workspace_id,
                Resource.space_id == QuizItem.space_id,
            ),
        )
        .where(
            topics,
            Topic.updated_at <= cutoff,
            QuizItem.deleted_at.is_(None),
            QuizItem.updated_at <= cutoff,
            or_(
                and_(QuizItem.research_owner_id.is_(None), Topic.research_owner_id.is_(None)),
                and_(
                    QuizItem.research_owner_id == user,
                    Topic.research_owner_id == user,
                    resource_scope,
                ),
            ),
        )
    )
    families = {
        "resource": resource_query,
        "text": text_query,
        "excerpt": excerpt_query,
        "topic": topic_query,
        "quiz": quiz_query,
    }
    candidates = union_all(
        *(value for key, value in families.items() if kind is None or key == kind)
    ).subquery()
    statement = select(candidates)
    if position:
        statement = statement.where(
            tuple_(candidates.c.kind, candidates.c.id) > (after_kind, after_id)
        )
    try:
        rows = (
            (
                await asyncio.wait_for(
                    db.execute(
                        statement.order_by(candidates.c.kind, candidates.c.id).limit(limit + 1)
                    ),
                    timeout=LIST_STATEMENT_TIMEOUT_SECONDS,
                )
            )
            .mappings()
            .all()
        )
    except TimeoutError as exc:
        raise query_timeout_error() from exc
    items = [ResearchSearchItem.model_validate(dict(row)) for row in rows[:limit]]
    next_cursor = (
        codec.encode(
            scope=scope,
            filters=filters,
            cutoff_at=cutoff,
            position={"kind": items[-1].kind, "id": str(items[-1].id)},
        )
        if len(rows) > limit
        else None
    )
    return ResearchSearchPage(items=items, next_cursor=next_cursor)
