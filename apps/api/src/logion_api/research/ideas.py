from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    request_id,
    require_trusted_origin,
)
from logion_api.identity.service import AuthContext
from logion_api.library.routes import require_enabled
from logion_api.research.models import ResearchIdea
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.models import WorkspaceMembership


class IdeaFields(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    body: Annotated[str, StringConstraints(max_length=100000)] = ""
    status: Literal["active", "archived"] = "active"


class IdeaUpdate(IdeaFields):
    expected_version: int = Field(ge=1)


class IdeaDelete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)


class IdeaResponse(IdeaFields):
    id: UUID
    workspace_id: UUID
    space_id: UUID
    version: int
    created_at: datetime
    updated_at: datetime


class IdeaPage(BaseModel):
    ideas: list[IdeaResponse]
    next_cursor: UUID | None = None


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/ideas",
    tags=["research-ideas"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


async def boundary(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    workspace_id: UUID,
    space_id: UUID,
    identity: IdentityServiceDependency,
    settings: SettingsDependency,
    limiter: RateLimiterDependency,
    x_csrf_token: str | None = Header(default=None),
) -> None:
    await workspaces.resolve_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    if request.method == "GET":
        return
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session, x_csrf_token, request.cookies.get(settings.csrf_cookie_name)
    )
    await limiter.enforce(
        scope="research_idea_write",
        subject_hash=get_security().privacy_hash(str(context.user.id)) or "unknown",
        limit=settings.research_write_limit_per_hour,
        window=3600,
    )
    member = await db.scalar(
        select(WorkspaceMembership.id)
        .where(
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.user_id == context.user.id,
            WorkspaceMembership.status == "active",
        )
        .with_for_update()
    )
    if member is None:
        raise missing()


def missing() -> APIError:
    return APIError(code="RESOURCE_NOT_FOUND", message="Idea not found.", status_code=404)


def scoped(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[ResearchIdea]]:
    return select(ResearchIdea).where(
        ResearchIdea.workspace_id == workspace,
        ResearchIdea.space_id == space,
        ResearchIdea.user_id == user,
        ResearchIdea.deleted_at.is_(None),
    )


async def find(
    db: AsyncSession, workspace: UUID, space: UUID, user: UUID, idea: UUID, *, write: bool = False
) -> ResearchIdea:
    query = scoped(workspace, space, user).where(ResearchIdea.id == idea)
    item = await db.scalar(query.with_for_update() if write else query)
    if item is None:
        raise missing()
    return item


def audit(db: AsyncSession, context: AuthContext, request: Request, action: str) -> None:
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"research.idea_{action}",
            result="success",
            actor_id=context.user.id,
            target_type="research_idea",
            metadata={},
        )
    )


def check_version(item: ResearchIdea, expected: int) -> None:
    if item.version != expected:
        raise APIError(code="RESOURCE_VERSION_CONFLICT", message="Idea changed.", status_code=409)


@router.get(
    "", response_model=IdeaPage, dependencies=[Depends(boundary)], operation_id="research_idea_list"
)
async def list_ideas(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> IdeaPage:
    query = scoped(workspace_id, space_id, context.user.id)
    if cursor is not None:
        query = query.where(ResearchIdea.id > cursor)
    rows = list(await db.scalars(query.order_by(ResearchIdea.id).limit(limit + 1)))
    return IdeaPage(
        ideas=[IdeaResponse.model_validate(row) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.get(
    "/{idea_id}",
    response_model=IdeaResponse,
    dependencies=[Depends(boundary)],
    operation_id="research_idea_get",
)
async def get_idea(
    workspace_id: UUID,
    space_id: UUID,
    idea_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> IdeaResponse:
    return IdeaResponse.model_validate(
        await find(db, workspace_id, space_id, context.user.id, idea_id)
    )


@router.post(
    "",
    response_model=IdeaResponse,
    status_code=201,
    dependencies=[Depends(boundary)],
    operation_id="research_idea_create",
)
async def create_idea(
    workspace_id: UUID,
    space_id: UUID,
    payload: IdeaFields,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> IdeaResponse:
    count = await db.scalar(
        select(func.count()).select_from(scoped(workspace_id, space_id, context.user.id).subquery())
    )
    if (count or 0) >= settings.research_entity_per_user_quota:
        raise APIError(
            code="RESOURCE_QUOTA_EXCEEDED", message="Idea limit reached.", status_code=409
        )
    item = ResearchIdea(
        workspace_id=workspace_id,
        space_id=space_id,
        user_id=context.user.id,
        created_by=context.user.id,
        updated_by=context.user.id,
        **payload.model_dump(),
    )
    db.add(item)
    await db.flush()
    audit(db, context, request, "created")
    result = IdeaResponse.model_validate(item)
    await db.commit()
    return result


@router.put(
    "/{idea_id}",
    response_model=IdeaResponse,
    dependencies=[Depends(boundary)],
    operation_id="research_idea_update",
)
async def update_idea(
    workspace_id: UUID,
    space_id: UUID,
    idea_id: UUID,
    payload: IdeaUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> IdeaResponse:
    item = await find(db, workspace_id, space_id, context.user.id, idea_id, write=True)
    check_version(item, payload.expected_version)
    item.title, item.body, item.status = payload.title, payload.body, payload.status
    item.updated_by, item.updated_at = context.user.id, utc_now()
    item.version += 1
    audit(db, context, request, "updated")
    result = IdeaResponse.model_validate(item)
    await db.commit()
    return result


@router.delete(
    "/{idea_id}",
    status_code=204,
    dependencies=[Depends(boundary)],
    operation_id="research_idea_delete",
)
async def delete_idea(
    workspace_id: UUID,
    space_id: UUID,
    idea_id: UUID,
    payload: IdeaDelete,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> Response:
    item = await find(db, workspace_id, space_id, context.user.id, idea_id, write=True)
    check_version(item, payload.expected_version)
    item.deleted_at = item.updated_at = utc_now()
    item.updated_by = context.user.id
    item.version += 1
    audit(db, context, request, "deleted")
    await db.commit()
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})
