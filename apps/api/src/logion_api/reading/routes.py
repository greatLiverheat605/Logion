import hashlib
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.knowledge_space.models import KnowledgeCitation, SourceExcerpt
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.text_models import SourceText
from logion_api.memory.models import Topic
from logion_api.reading.selections import selected_text
from logion_api.workspaces.models import Space


class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_text_id: UUID
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=1)


async def selection_source(
    db: AsyncSession, resource: Resource, selection: Selection
) -> SourceText:
    source = await db.scalar(
        select(SourceText).where(
            SourceText.id == selection.source_text_id,
            SourceText.resource_id == resource.id,
            SourceText.file_sha256 == resource.sha256,
            SourceText.deleted_at.is_(None),
        )
    )
    if source is None:
        raise APIError(
            code="SOURCE_FILE_CHANGED", message="Reopen the current source file.", status_code=409
        )
    return source


class ExcerptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    resource_id: UUID
    origin: str
    excerpt_text: str
    page_start: int | None
    page_end: int | None
    char_start: int | None
    char_end: int | None
    source_file_sha256: str | None
    status: str
    version: int


class ExcerptPage(BaseModel):
    excerpts: list[ExcerptResponse]


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources/{resource_id}",
    tags=["research-reading"],
    dependencies=[Depends(require_enabled)],
)


async def save_excerpt(
    db: AsyncSession, resource: Resource, selection: Selection, user_id: UUID
) -> SourceExcerpt:
    source = await selection_source(db, resource, selection)
    value = selected_text(source, selection.char_start, selection.char_end)
    existing = await db.scalar(
        select(SourceExcerpt).where(
            SourceExcerpt.resource_id == resource.id,
            SourceExcerpt.origin == "logion",
            SourceExcerpt.source_file_sha256 == source.file_sha256,
            SourceExcerpt.char_start == selection.char_start,
            SourceExcerpt.char_end == selection.char_end,
            SourceExcerpt.status == "active",
        )
    )
    if existing is not None:
        return existing
    count = await db.scalar(
        select(func.count())
        .select_from(SourceExcerpt)
        .where(SourceExcerpt.resource_id == resource.id)
    )
    if (count or 0) >= 10000:
        raise APIError(
            code="RESOURCE_QUOTA_EXCEEDED", message="Excerpt limit reached.", status_code=409
        )
    pages = [
        i + 1
        for i, p in enumerate(source.page_offsets)
        if p["start"] < selection.char_end and p["end"] > selection.char_start
    ]
    if not pages:
        raise APIError(
            code="SOURCE_SELECTION_INVALID",
            message="Page offsets are unavailable.",
            status_code=409,
        )
    row = SourceExcerpt(
        workspace_id=resource.workspace_id,
        space_id=resource.space_id,
        resource_id=resource.id,
        resource_version=resource.version,
        origin="logion",
        source_version_key=f"source-text:{source.id}:{source.version}",
        source_file_sha256=source.file_sha256,
        source_version_sha256=hashlib.sha256(source.text.encode("utf-8")).hexdigest(),
        excerpt_text=value,
        excerpt_sha256=hashlib.sha256(value.encode("utf-8")).hexdigest(),
        page_start=pages[0],
        page_end=pages[-1],
        char_start=selection.char_start,
        char_end=selection.char_end,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(row)
    await db.flush()
    return row


@router.get("/excerpts", response_model=ExcerptPage, operation_id="research_excerpts_list")
async def list_excerpts(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ExcerptPage:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    rows = await db.scalars(
        select(SourceExcerpt)
        .where(SourceExcerpt.resource_id == resource.id, SourceExcerpt.deleted_at.is_(None))
        .order_by(SourceExcerpt.created_at.desc(), SourceExcerpt.id)
        .limit(1000)
    )
    return ExcerptPage(excerpts=[ExcerptResponse.model_validate(row) for row in rows])


@router.post(
    "/excerpts",
    response_model=ExcerptResponse,
    status_code=201,
    operation_id="research_excerpt_create",
    dependencies=[Depends(write_boundary)],
)
async def create_excerpt(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: Selection,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ExcerptResponse:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    row = await save_excerpt(db, resource, payload, context.user.id)
    service.audit(db, context, request_id(request), "excerpt_created")
    result = ExcerptResponse.model_validate(row)
    await db.commit()
    return result


class ReadingConceptResponse(BaseModel):
    topic_id: UUID
    citation_id: UUID
    excerpt: ExcerptResponse


@router.post(
    "/concepts",
    response_model=ReadingConceptResponse,
    status_code=201,
    operation_id="research_concept_create",
    dependencies=[Depends(write_boundary)],
)
async def create_concept(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: Selection,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingConceptResponse:
    # Space then resource follows the shared content lock order; the private quota
    # cannot be raced using selections from different papers.
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    excerpt = await save_excerpt(db, resource, payload, context.user.id)
    citation = await db.scalar(
        select(KnowledgeCitation)
        .join(Topic, Topic.id == KnowledgeCitation.topic_id)
        .where(
            KnowledgeCitation.source_excerpt_id == excerpt.id,
            KnowledgeCitation.relationship_kind == "definition",
            KnowledgeCitation.status == "active",
            Topic.research_owner_id == context.user.id,
            Topic.deleted_at.is_(None),
        )
    )
    if citation is None:
        count = await db.scalar(
            select(func.count())
            .select_from(Topic)
            .where(
                Topic.space_id == space_id,
                Topic.research_owner_id == context.user.id,
                Topic.deleted_at.is_(None),
            )
        )
        if (count or 0) >= 10000:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="Reading concept limit reached.",
                status_code=409,
            )
        topic = Topic(
            workspace_id=workspace_id,
            space_id=space_id,
            research_owner_id=context.user.id,
            title=excerpt.excerpt_text.strip()[:160],
            description=excerpt.excerpt_text,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(topic)
        await db.flush()
        citation = KnowledgeCitation(
            workspace_id=workspace_id,
            space_id=space_id,
            source_excerpt_id=excerpt.id,
            relationship_kind="definition",
            topic_id=topic.id,
            acceptance_operation_id=uuid4(),
            accepted_by=context.user.id,
            accepted_at=utc_now(),
            created_by=context.user.id,
        )
        db.add(citation)
        await db.flush()
    assert citation.topic_id is not None
    result = ReadingConceptResponse(
        topic_id=citation.topic_id,
        citation_id=citation.id,
        excerpt=ExcerptResponse.model_validate(excerpt),
    )
    service.audit(db, context, request_id(request), "concept_created")
    await db.commit()
    return result
