"""Online question tree. Grouping preserves source records and their citations."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.research.models import ResearchQuestion
from logion_api.research.schemas import Long, OptionalText


class QuestionFields(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    question: Long
    rationale: OptionalText = ""
    status: Literal["active", "answered", "parked"] = "active"


class TreeQuestionCreate(QuestionFields):
    parent_id: UUID | None = None


class TreeQuestionUpdate(TreeQuestionCreate):
    expected_version: int = Field(ge=1)


class TreeQuestion(TreeQuestionCreate):
    id: UUID
    version: int
    created_at: datetime
    updated_at: datetime


class QuestionPage(BaseModel):
    questions: list[TreeQuestion]
    next_cursor: UUID | None = None


class QuestionReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    expected_version: int = Field(ge=1)


class QuestionSplit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    children: list[QuestionFields] = Field(min_length=2, max_length=20)


class QuestionMerge(QuestionFields):
    sources: list[QuestionReference] = Field(min_length=2, max_length=20)

    @model_validator(mode="after")
    def unique_sources(self) -> "QuestionMerge":
        if len({item.id for item in self.sources}) != len(self.sources):
            raise ValueError("Choose distinct questions")
        return self


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/question-tree",
    tags=["research-questions"],
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


def scoped(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[ResearchQuestion]]:
    return select(ResearchQuestion).where(
        ResearchQuestion.workspace_id == workspace,
        ResearchQuestion.space_id == space,
        ResearchQuestion.user_id == user,
        ResearchQuestion.deleted_at.is_(None),
    )


def invalid(code: str = "QUESTION_TREE_INVALID") -> APIError:
    return APIError(code=code, message="Question hierarchy is invalid.", status_code=409)


async def find(
    db: AsyncSession, workspace: UUID, space: UUID, user: UUID, identity: UUID
) -> ResearchQuestion:
    item = await db.scalar(scoped(workspace, space, user).where(ResearchQuestion.id == identity))
    if item is None:
        raise APIError(code="RESOURCE_NOT_FOUND", message="Question not found.", status_code=404)
    return item


def check_version(item: ResearchQuestion, expected: int) -> None:
    if item.version != expected:
        raise invalid("RESOURCE_VERSION_CONFLICT")


async def parents(
    db: AsyncSession, workspace: UUID, space: UUID, user: UUID
) -> dict[UUID, UUID | None]:
    # Only IDs enter hierarchy validation; never load every question's potentially long text.
    rows = await db.execute(
        scoped(workspace, space, user).with_only_columns(
            ResearchQuestion.id, ResearchQuestion.parent_id
        )
    )
    return {row.id: row.parent_id for row in rows}


def validate_tree(tree: dict[UUID, UUID | None]) -> None:
    depths: dict[UUID, int] = {}
    for identity in tree:
        chain: list[UUID] = []
        seen: set[UUID] = set()
        current: UUID | None = identity
        while current is not None and current not in depths:
            if current in seen or current not in tree or len(chain) >= 32:
                raise invalid()
            seen.add(current)
            chain.append(current)
            current = tree[current]
        depth = depths.get(current, 0) if current is not None else 0
        for node in reversed(chain):
            depth += 1
            if depth > 32:
                raise invalid()
            depths[node] = depth


async def quota(
    db: AsyncSession, workspace: UUID, user: UUID, additional: int, maximum: int
) -> None:
    count = await db.scalar(
        select(func.count())
        .select_from(ResearchQuestion)
        .where(
            ResearchQuestion.workspace_id == workspace,
            ResearchQuestion.user_id == user,
            ResearchQuestion.deleted_at.is_(None),
        )
    )
    if (count or 0) + additional > maximum:
        raise invalid("RESOURCE_QUOTA_EXCEEDED")


def touch(item: ResearchQuestion, user: UUID) -> None:
    item.version += 1
    item.updated_at, item.updated_by = utc_now(), user


def audit(db: AsyncSession, request: Request, user: UUID, action: str) -> None:
    # Private research actions never expose identifiers or text through shared Space audit.
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"research.question_{action}",
            result="success",
            actor_id=user,
            target_type="research_question",
            metadata={},
        )
    )


def new_question(
    workspace: UUID, space: UUID, user: UUID, fields: QuestionFields, parent_id: UUID | None
) -> ResearchQuestion:
    return ResearchQuestion(
        id=uuid7(),
        workspace_id=workspace,
        space_id=space,
        user_id=user,
        created_by=user,
        updated_by=user,
        parent_id=parent_id,
        **fields.model_dump(include={"question", "rationale", "status"}),
    )


@router.get(
    "",
    response_model=QuestionPage,
    dependencies=[Depends(scope)],
    operation_id="research_question_tree_list",
)
async def list_questions(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> QuestionPage:
    query = scoped(workspace_id, space_id, context.user.id)
    if cursor is not None:
        query = query.where(ResearchQuestion.id > cursor)
    rows = list(await db.scalars(query.order_by(ResearchQuestion.id).limit(limit + 1)))
    return QuestionPage(
        questions=[TreeQuestion.model_validate(row) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.get(
    "/{question_id}",
    response_model=TreeQuestion,
    dependencies=[Depends(scope)],
    operation_id="research_question_tree_get",
)
async def get_question(
    workspace_id: UUID,
    space_id: UUID,
    question_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> TreeQuestion:
    return TreeQuestion.model_validate(
        await find(db, workspace_id, space_id, context.user.id, question_id)
    )


@router.post(
    "",
    response_model=TreeQuestion,
    status_code=201,
    dependencies=[Depends(write_boundary), Depends(scope)],
    operation_id="research_question_tree_create",
)
async def create_question(
    workspace_id: UUID,
    space_id: UUID,
    payload: TreeQuestionCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> TreeQuestion:
    if payload.parent_id is not None:
        await find(db, workspace_id, space_id, context.user.id, payload.parent_id)
    await quota(db, workspace_id, context.user.id, 1, settings.research_entity_per_user_quota)
    item = new_question(workspace_id, space_id, context.user.id, payload, payload.parent_id)
    tree = await parents(db, workspace_id, space_id, context.user.id)
    tree[item.id] = item.parent_id
    validate_tree(tree)
    db.add(item)
    await db.flush()
    audit(db, request, context.user.id, "created")
    result = TreeQuestion.model_validate(item)
    await db.commit()
    return result


@router.put(
    "/{question_id}",
    response_model=TreeQuestion,
    dependencies=[Depends(write_boundary), Depends(scope)],
    operation_id="research_question_tree_update",
)
async def update_question(
    workspace_id: UUID,
    space_id: UUID,
    question_id: UUID,
    payload: TreeQuestionUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> TreeQuestion:
    item = await find(db, workspace_id, space_id, context.user.id, question_id)
    check_version(item, payload.expected_version)
    if payload.parent_id is not None:
        await find(db, workspace_id, space_id, context.user.id, payload.parent_id)
    tree = await parents(db, workspace_id, space_id, context.user.id)
    tree[item.id] = payload.parent_id
    validate_tree(tree)
    item.question, item.rationale, item.status = payload.question, payload.rationale, payload.status
    item.parent_id = payload.parent_id
    touch(item, context.user.id)
    audit(db, request, context.user.id, "updated")
    result = TreeQuestion.model_validate(item)
    await db.commit()
    return result


@router.post(
    "/{question_id}/split",
    response_model=QuestionPage,
    dependencies=[Depends(write_boundary), Depends(scope)],
    operation_id="research_question_split",
)
async def split_question(
    workspace_id: UUID,
    space_id: UUID,
    question_id: UUID,
    payload: QuestionSplit,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> QuestionPage:
    parent = await find(db, workspace_id, space_id, context.user.id, question_id)
    check_version(parent, payload.expected_version)
    await quota(
        db,
        workspace_id,
        context.user.id,
        len(payload.children),
        settings.research_entity_per_user_quota,
    )
    children = [
        new_question(workspace_id, space_id, context.user.id, fields, parent.id)
        for fields in payload.children
    ]
    tree = await parents(db, workspace_id, space_id, context.user.id)
    tree.update({item.id: item.parent_id for item in children})
    validate_tree(tree)
    db.add_all(children)
    touch(parent, context.user.id)
    await db.flush()
    audit(db, request, context.user.id, "split")
    result = QuestionPage(
        questions=[TreeQuestion.model_validate(row) for row in [parent, *children]]
    )
    await db.commit()
    return result


@router.post(
    "/merge",
    response_model=TreeQuestion,
    status_code=201,
    dependencies=[Depends(write_boundary), Depends(scope)],
    operation_id="research_question_merge",
)
async def merge_questions(
    workspace_id: UUID,
    space_id: UUID,
    payload: QuestionMerge,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
) -> TreeQuestion:
    sources = []
    for ref in payload.sources:
        item = await find(db, workspace_id, space_id, context.user.id, ref.id)
        check_version(item, ref.expected_version)
        sources.append(item)
    tree = await parents(db, workspace_id, space_id, context.user.id)
    validate_tree(tree)
    selected = {item.id for item in sources}
    for item in sources:
        ancestor = tree[item.id]
        while ancestor is not None:
            if ancestor in selected:
                raise invalid("QUESTION_MERGE_OVERLAP")
            ancestor = tree[ancestor]
    await quota(db, workspace_id, context.user.id, 1, settings.research_entity_per_user_quota)
    parent = new_question(workspace_id, space_id, context.user.id, payload, None)
    tree[parent.id] = None
    tree.update({item.id: parent.id for item in sources})
    validate_tree(tree)
    db.add(parent)
    await db.flush()
    for item in sources:
        item.parent_id = parent.id
        touch(item, context.user.id)
    audit(db, request, context.user.id, "merged")
    result = TreeQuestion.model_validate(parent)
    await db.commit()
    return result
