from dataclasses import dataclass
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy import Select, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.online_routes import NoteAccess
from logion_api.db import utc_now
from logion_api.form_drafts.service import consume as consume_form_draft
from logion_api.form_drafts.service import prepare_submission
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.identity.service import AuthContext
from logion_api.library.routes import require_enabled
from logion_api.library.service import not_found
from logion_api.memory import online_service as online
from logion_api.memory.dependencies import MemoryServiceDependency
from logion_api.memory.models import (
    ErrorPattern,
    KnowledgeSourceLink,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewSchedule,
    Topic,
)
from logion_api.memory.online_schemas import (
    OnlineAttemptPage,
    OnlineDependencyPage,
    OnlineMemoryDelete,
    OnlineNoteSource,
    OnlineQuizUpdate,
    OnlineRecallItem,
    OnlineRecallPage,
    OnlineSourcePage,
    OnlineTopicDetail,
    OnlineTopicPage,
    OnlineTopicUpdate,
)
from logion_api.memory.routes import (
    ERRORS,
    attempt_response,
    error_pattern_response,
    mastery_response,
    quiz_item_response,
    schedule_response,
    topic_response,
    write_boundary,
)
from logion_api.memory.schemas import (
    MasteryConfirmationResponse,
    MasteryConfirmRequest,
    QuizAttemptCreateRequest,
    QuizAttemptResponse,
    QuizItemCreateRequest,
    QuizItemResponse,
    QuizItemUpdateRequest,
    TopicCreateRequest,
    TopicDependencyCreateRequest,
    TopicDependencyResponse,
    TopicResponse,
)
from logion_api.memory.service import MemoryService, QuizAttemptResult
from logion_api.sync.deletion import deletion_scope
from logion_api.sync.models import WorkspaceSyncState
from logion_api.sync.push import (
    error_pattern_payload,
    mastery_payload,
    quiz_attempt_payload,
    quiz_item_payload,
    review_schedule_payload,
    topic_dependency_payload,
    topic_payload,
)
from logion_api.sync.schemas import DeletionPreview
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.models import Space
from logion_api.workspaces.service import WorkspaceService

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/memory",
    tags=["research-memory"],
    dependencies=[Depends(require_enabled)],
    responses=ERRORS,
)
Limit = Annotated[int, Query(ge=1, le=100)]


@dataclass
class MemoryScope:
    db: AsyncSession
    context: AuthContext
    memory: MemoryService
    workspaces: WorkspaceService
    workspace_id: UUID
    space_id: UUID
    request_id: str
    can_edit: bool
    state: WorkspaceSyncState | None = None


async def read_scope(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    db: DatabaseSession,
    context: AuthContextDependency,
    memory: MemoryServiceDependency,
    workspaces: WorkspaceServiceDependency,
    writable: NoteAccess,
) -> MemoryScope:
    return MemoryScope(
        db, context, memory, workspaces, workspace_id, space_id, request_id(request), writable
    )


Read = Annotated[MemoryScope, Depends(read_scope)]


async def write_scope(
    scope: Read,
    request: Request,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MemoryScope:
    await write_boundary(
        request, scope.context, identity, limiter, settings, scope.workspace_id, x_csrf_token
    )
    scope.state = await SyncLedgerService().lock_workspace_state(scope.db, scope.workspace_id)
    await scope.memory._resolve_space(
        scope.db,
        scope.context,
        scope.workspace_id,
        scope.space_id,
        scope.request_id,
        shared_write=False,
    )
    await scope.db.scalar(select(Space.id).where(Space.id == scope.space_id).with_for_update())
    return scope


Write = Annotated[MemoryScope, Depends(write_scope)]


async def commit(scope: MemoryScope, rows: list[tuple[str, Any, dict[str, object]]]) -> None:
    assert scope.state is not None
    for kind, row, payload in rows:
        await online.append(scope.db, scope.context, scope.state, kind, row, payload)
    await consume_form_draft(scope.db)
    await scope.db.commit()


def topic_query(scope: MemoryScope) -> Select[tuple[Topic, MasteryRecord, ReviewSchedule]]:
    return (
        online.topics(scope.workspace_id, scope.space_id)
        .add_columns(MasteryRecord, ReviewSchedule)
        .outerjoin(
            MasteryRecord,
            (MasteryRecord.topic_id == Topic.id)
            & (MasteryRecord.user_id == scope.context.user.id)
            & MasteryRecord.deleted_at.is_(None),
        )
        .outerjoin(
            ReviewSchedule,
            (ReviewSchedule.topic_id == Topic.id)
            & (ReviewSchedule.user_id == scope.context.user.id)
            & ReviewSchedule.deleted_at.is_(None),
        )
    )


@router.get("/topics", response_model=OnlineTopicPage, operation_id="online_memory_topics")
async def list_topics(
    scope: Read, cursor: UUID | None = None, due_only: bool = False, limit: Limit = 50
) -> OnlineTopicPage:
    query = topic_query(scope)
    if cursor is not None:
        query = query.where(Topic.id > cursor)
    if due_only:
        query = query.where(
            ReviewSchedule.status.in_(("scheduled", "due", "in_progress")),
            ReviewSchedule.next_review_at <= utc_now(),
        )
    rows = (await scope.db.execute(query.order_by(Topic.id).limit(limit + 1))).all()
    return OnlineTopicPage(
        topics=[topic_response(*row) for row in rows[:limit]],
        next_cursor=rows[limit - 1][0].id if len(rows) > limit else None,
        can_edit=scope.can_edit,
    )


@router.get(
    "/topics/{topic_id}", response_model=OnlineTopicDetail, operation_id="online_memory_topic"
)
async def get_topic(topic_id: UUID, scope: Read) -> OnlineTopicDetail:
    row = (await scope.db.execute(topic_query(scope).where(Topic.id == topic_id))).one_or_none()
    if row is None:
        raise not_found()
    patterns = await scope.db.scalars(
        select(ErrorPattern)
        .where(
            ErrorPattern.topic_id == topic_id,
            ErrorPattern.user_id == scope.context.user.id,
            ErrorPattern.deleted_at.is_(None),
        )
        .order_by(ErrorPattern.id)
        .limit(100)
    )
    return OnlineTopicDetail(
        topic=topic_response(*row),
        can_edit=scope.can_edit,
        error_patterns=[error_pattern_response(p) for p in patterns],
    )


@router.get(
    "/topics/{topic_id}/dependencies",
    response_model=OnlineDependencyPage,
    operation_id="online_memory_dependencies",
)
async def dependencies(
    topic_id: UUID, scope: Read, cursor: UUID | None = None, limit: Limit = 50
) -> OnlineDependencyPage:
    await online.target(scope.db, scope.workspace_id, scope.space_id, "topic", topic_id)
    query = online.dependency_query(scope.workspace_id, scope.space_id, topic_id)
    from logion_api.memory.models import TopicDependency

    if cursor is not None:
        query = query.where(TopicDependency.id > cursor)
    rows = list(await scope.db.scalars(query.order_by(TopicDependency.id).limit(limit + 1)))
    return OnlineDependencyPage(
        dependencies=[
            TopicDependencyResponse(
                id=d.id,
                prerequisite_topic_id=d.prerequisite_topic_id,
                dependent_topic_id=d.dependent_topic_id,
                version=d.version,
            )
            for d in rows[:limit]
        ],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.post(
    "/topics",
    response_model=TopicResponse,
    status_code=201,
    operation_id="online_memory_topic_create",
    dependencies=[Depends(prepare_submission)],
)
async def create_topic(payload: TopicCreateRequest, scope: Write) -> TopicResponse:
    row = await scope.memory.create_topic(
        scope.db, scope.context, scope.workspace_id, scope.space_id, payload, scope.request_id
    )
    result = topic_response(row)
    await commit(scope, [("topic", row, topic_payload(row))])
    return result


@router.patch(
    "/topics/{topic_id}",
    response_model=TopicResponse,
    operation_id="online_memory_topic_update",
    dependencies=[Depends(prepare_submission)],
)
async def update_topic(topic_id: UUID, payload: OnlineTopicUpdate, scope: Write) -> TopicResponse:
    if payload.id != topic_id:
        raise not_found()
    row = await scope.memory.update_topic(
        scope.db,
        scope.context,
        scope.workspace_id,
        scope.space_id,
        TopicCreateRequest.model_validate(payload.model_dump(exclude={"expected_version"})),
        payload.expected_version,
        scope.request_id,
    )
    await scope.db.flush()
    result = topic_response(row)
    await commit(scope, [("topic", row, topic_payload(row))])
    return result


@router.post(
    "/dependencies",
    response_model=TopicDependencyResponse,
    status_code=201,
    operation_id="online_memory_dependency_create",
)
async def create_dependency(
    payload: TopicDependencyCreateRequest, scope: Write
) -> TopicDependencyResponse:
    row = await scope.memory.add_dependency(
        scope.db, scope.context, scope.workspace_id, scope.space_id, payload, scope.request_id
    )
    result = TopicDependencyResponse(
        id=row.id,
        prerequisite_topic_id=row.prerequisite_topic_id,
        dependent_topic_id=row.dependent_topic_id,
        version=row.version,
    )
    await commit(scope, [("topic_dependency", row, topic_dependency_payload(row))])
    return result


@router.get(
    "/topics/{topic_id}/quizzes",
    response_model=OnlineRecallPage,
    operation_id="online_memory_quizzes",
)
async def list_quizzes(
    topic_id: UUID, scope: Read, cursor: UUID | None = None, limit: Limit = 50
) -> OnlineRecallPage:
    await online.target(scope.db, scope.workspace_id, scope.space_id, "topic", topic_id)
    attempted = exists(select(QuizAttempt.id).where(QuizAttempt.quiz_item_id == QuizItem.id))
    query = select(QuizItem, attempted).where(
        QuizItem.workspace_id == scope.workspace_id,
        QuizItem.space_id == scope.space_id,
        QuizItem.topic_id == topic_id,
        QuizItem.research_owner_id.is_(None),
        QuizItem.deleted_at.is_(None),
    )
    if cursor is not None:
        query = query.where(QuizItem.id > cursor)
    rows = (await scope.db.execute(query.order_by(QuizItem.id).limit(limit + 1))).all()
    return OnlineRecallPage(
        quiz_items=[
            OnlineRecallItem(**quiz_item_response(q).model_dump(), has_attempts=attempted)
            for q, attempted in rows[:limit]
        ],
        next_cursor=rows[limit - 1][0].id if len(rows) > limit else None,
    )


@router.post(
    "/quizzes",
    response_model=QuizItemResponse,
    status_code=201,
    operation_id="online_memory_quiz_create",
    dependencies=[Depends(prepare_submission)],
)
async def create_quiz(payload: QuizItemCreateRequest, scope: Write) -> QuizItemResponse:
    row = await scope.memory.create_quiz_item(
        scope.db, scope.context, scope.workspace_id, scope.space_id, payload, scope.request_id
    )
    result = quiz_item_response(row)
    await commit(scope, [("quiz_item", row, quiz_item_payload(row))])
    return result


@router.patch(
    "/quizzes/{quiz_id}",
    response_model=QuizItemResponse,
    operation_id="online_memory_quiz_update",
    dependencies=[Depends(prepare_submission)],
)
async def update_quiz(quiz_id: UUID, payload: OnlineQuizUpdate, scope: Write) -> QuizItemResponse:
    if payload.id != quiz_id:
        raise not_found()
    row = await scope.memory.update_quiz_item(
        scope.db,
        scope.context,
        scope.workspace_id,
        scope.space_id,
        QuizItemUpdateRequest.model_validate(payload.model_dump(exclude={"expected_version"})),
        payload.expected_version,
        scope.request_id,
    )
    await scope.db.flush()
    result = quiz_item_response(row)
    await commit(scope, [("quiz_item", row, quiz_item_payload(row))])
    return result


@router.post(
    "/quizzes/{quiz_id}/attempts",
    response_model=QuizAttemptResponse,
    status_code=201,
    operation_id="online_memory_attempt_create",
    dependencies=[Depends(prepare_submission)],
)
async def attempt(
    quiz_id: UUID, payload: QuizAttemptCreateRequest, scope: Write
) -> QuizAttemptResponse:
    result = await scope.memory.submit_quiz_attempt(
        scope.db,
        scope.context,
        scope.workspace_id,
        scope.space_id,
        quiz_id,
        payload,
        scope.request_id,
    )
    rows: list[tuple[str, Any, dict[str, object]]] = [
        ("quiz_attempt", result.attempt, quiz_attempt_payload(result.attempt, result.item))
    ]
    if result.error_pattern is not None:
        rows.append(
            ("error_pattern", result.error_pattern, error_pattern_payload(result.error_pattern))
        )
    if result.review_schedule is not None:
        rows.append(
            (
                "review_schedule",
                result.review_schedule,
                review_schedule_payload(result.review_schedule),
            )
        )
    response = attempt_response(result)
    await commit(scope, rows)
    return response


@router.get(
    "/topics/{topic_id}/attempts",
    response_model=OnlineAttemptPage,
    operation_id="online_memory_attempts",
)
async def attempts(
    topic_id: UUID, scope: Read, cursor: UUID | None = None, limit: Limit = 50
) -> OnlineAttemptPage:
    await online.target(scope.db, scope.workspace_id, scope.space_id, "topic", topic_id)
    query = (
        select(QuizAttempt, QuizItem)
        .join(QuizItem, QuizItem.id == QuizAttempt.quiz_item_id)
        .where(
            QuizAttempt.topic_id == topic_id,
            QuizAttempt.workspace_id == scope.workspace_id,
            QuizAttempt.space_id == scope.space_id,
            QuizAttempt.user_id == scope.context.user.id,
            QuizAttempt.deleted_at.is_(None),
            QuizItem.research_owner_id.is_(None),
        )
    )
    if cursor is not None:
        query = query.where(QuizAttempt.id < cursor)
    rows = (await scope.db.execute(query.order_by(QuizAttempt.id.desc()).limit(limit + 1))).all()
    return OnlineAttemptPage(
        attempts=[attempt_response(QuizAttemptResult(a, q, None, None)) for a, q in rows[:limit]],
        next_cursor=rows[limit - 1][0].id if len(rows) > limit else None,
    )


@router.put(
    "/topics/{topic_id}/mastery",
    response_model=MasteryConfirmationResponse,
    operation_id="online_memory_mastery_confirm",
)
async def mastery(
    topic_id: UUID, payload: MasteryConfirmRequest, scope: Write
) -> MasteryConfirmationResponse:
    result = await scope.memory.confirm_mastery(
        scope.db,
        scope.context,
        scope.workspace_id,
        scope.space_id,
        topic_id,
        payload,
        scope.request_id,
    )
    response = MasteryConfirmationResponse(
        mastery=mastery_response(result.mastery),
        review_schedule=schedule_response(result.review_schedule),
    )
    await commit(
        scope,
        [
            ("mastery", result.mastery, mastery_payload(result.mastery)),
            (
                "review_schedule",
                result.review_schedule,
                review_schedule_payload(result.review_schedule),
            ),
        ],
    )
    return response


@router.get("/sources", response_model=OnlineSourcePage, operation_id="online_memory_sources")
async def sources(
    scope: Read,
    target_kind: Literal["topic", "quiz_item"],
    target_id: UUID,
    cursor: UUID | None = None,
    limit: Limit = 50,
) -> OnlineSourcePage:
    await online.target(scope.db, scope.workspace_id, scope.space_id, target_kind, target_id)
    query = online.source_query(scope.workspace_id, scope.space_id).where(
        KnowledgeSourceLink.target_kind == target_kind, KnowledgeSourceLink.target_id == target_id
    )
    if cursor is not None:
        query = query.where(KnowledgeSourceLink.id > cursor)
    rows = list(await scope.db.scalars(query.order_by(KnowledgeSourceLink.id).limit(limit + 1)))
    return OnlineSourcePage(
        sources=[
            await online.source_view(scope.db, scope.workspace_id, scope.space_id, row)
            for row in rows[:limit]
        ],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.get(
    "/sources/{source_id}", response_model=OnlineNoteSource, operation_id="online_memory_source"
)
async def source(source_id: UUID, scope: Read) -> OnlineNoteSource:
    link = await scope.db.scalar(
        online.source_query(scope.workspace_id, scope.space_id).where(
            KnowledgeSourceLink.id == source_id
        )
    )
    if link is None:
        raise not_found()
    return await online.source_view(scope.db, scope.workspace_id, scope.space_id, link, locate=True)


@router.get(
    "/entities/{kind}/{identifier}/deletion",
    response_model=DeletionPreview,
    operation_id="online_memory_delete_preview",
)
async def preview(kind: online.MemoryKind, identifier: UUID, scope: Read) -> DeletionPreview:
    await online.target(scope.db, scope.workspace_id, scope.space_id, kind, identifier)
    result = await deletion_scope(
        scope.db,
        scope.workspaces,
        scope.context,
        scope.workspace_id,
        kind,
        identifier,
        scope.request_id,
    )
    return DeletionPreview(
        server_version=result.root.version,
        impact=result.impact,
        blockers=result.blockers,
        can_delete=result.root.deleted_at is None and not any(result.blockers.values()),
    )


@router.delete(
    "/entities/{kind}/{identifier}", status_code=204, operation_id="online_memory_delete"
)
async def delete(
    kind: online.MemoryKind, identifier: UUID, payload: OnlineMemoryDelete, scope: Write
) -> Response:
    assert scope.state is not None
    await online.retire(
        scope.db,
        scope.workspaces,
        scope.context,
        scope.state,
        scope.workspace_id,
        scope.space_id,
        kind,
        identifier,
        payload.expected_version,
        scope.request_id,
    )
    await scope.db.commit()
    return Response(status_code=204)
