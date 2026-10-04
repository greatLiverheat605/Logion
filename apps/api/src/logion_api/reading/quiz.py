import json
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.dependencies import AIRunServiceDependency
from logion_api.ai_gateway.models import AIOutputDraft, AIRun
from logion_api.ai_gateway.research_routes import ResearchRunResult
from logion_api.ai_gateway.run_routes import draft_response, run_response, run_write_boundary
from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
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
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.service import not_found
from logion_api.memory.dependencies import MemoryServiceDependency
from logion_api.memory.models import MasteryRecord, QuizAttempt, QuizItem, ReviewSchedule, Topic
from logion_api.memory.routes import mastery_response, schedule_response
from logion_api.memory.schemas import MasteryConfirmationResponse, MasteryConfirmRequest
from logion_api.reading.notes import ReadingNoteRuns
from logion_api.reading.quiz_types import (
    ReadingAnswer,
    ReadingAttempt,
    ReadingAttemptCreate,
    ReadingGrade,
    ReadingQuiz,
    ReadingQuizDecision,
    ReadingQuizItem,
    parse_questions,
)

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources/{resource_id}/quiz",
    tags=["research-reading"],
    dependencies=[Depends(require_enabled)],
)


def attempt_response(attempt: QuizAttempt) -> ReadingAttempt:
    return ReadingAttempt(
        id=attempt.id,
        quiz_item_id=attempt.quiz_item_id,
        response_text=attempt.response_text,
        attempted_at=attempt.attempted_at,
        version=attempt.version,
        ai_grade=ReadingGrade.model_validate_json(json.dumps(attempt.ai_grade))
        if attempt.ai_grade
        else None,
    )


async def quiz_response(db: AsyncSession, resource: Resource) -> ReadingQuiz:
    pairs = (
        await db.execute(
            select(QuizItem, Topic)
            .join(Topic, Topic.id == QuizItem.topic_id)
            .where(
                QuizItem.resource_id == resource.id,
                QuizItem.research_owner_id == resource.research_owner_id,
                QuizItem.deleted_at.is_(None),
                Topic.deleted_at.is_(None),
            )
            .order_by(QuizItem.created_at, QuizItem.id)
            .limit(100)
        )
    ).all()
    ids = [item.id for item, _ in pairs]
    topics = [topic.id for _, topic in pairs]
    attempts = {
        row.quiz_item_id: row
        for row in await db.scalars(
            select(QuizAttempt)
            .where(
                QuizAttempt.quiz_item_id.in_(ids),
                QuizAttempt.user_id == resource.research_owner_id,
                QuizAttempt.deleted_at.is_(None),
            )
            .distinct(QuizAttempt.quiz_item_id)
            .order_by(
                QuizAttempt.quiz_item_id, QuizAttempt.attempted_at.desc(), QuizAttempt.id.desc()
            )
        )
    }
    masteries = {
        row.topic_id: row
        for row in await db.scalars(
            select(MasteryRecord).where(
                MasteryRecord.topic_id.in_(topics),
                MasteryRecord.user_id == resource.research_owner_id,
                MasteryRecord.deleted_at.is_(None),
            )
        )
    }
    schedules = {
        row.topic_id: row
        for row in await db.scalars(
            select(ReviewSchedule).where(
                ReviewSchedule.topic_id.in_(topics),
                ReviewSchedule.user_id == resource.research_owner_id,
                ReviewSchedule.deleted_at.is_(None),
            )
        )
    }
    return ReadingQuiz(
        items=[
            ReadingQuizItem(
                id=item.id,
                resource_id=resource.id,
                topic_id=topic.id,
                concept=topic.title,
                prompt=item.prompt,
                origin="ai" if item.origin == "ai" else "user",
                ai_run_id=item.ai_run_id,
                version=item.version,
                latest_attempt=attempt_response(attempts[item.id]) if item.id in attempts else None,
                mastery=mastery_response(masteries[topic.id]) if topic.id in masteries else None,
                review_schedule=schedule_response(schedules[topic.id])
                if topic.id in schedules
                else None,
            )
            for item, topic in pairs
        ]
    )


async def load_item(db: AsyncSession, resource: Resource, item_id: UUID) -> QuizItem:
    item = await db.scalar(
        select(QuizItem).where(
            QuizItem.id == item_id,
            QuizItem.resource_id == resource.id,
            QuizItem.research_owner_id == resource.research_owner_id,
            QuizItem.deleted_at.is_(None),
        )
    )
    if item is None:
        raise not_found()
    return item


@router.get("", response_model=ReadingQuiz, operation_id="reading_quiz_get")
async def get_quiz(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingQuiz:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    return await quiz_response(db, resource)


@router.get("/ai-runs", response_model=ReadingNoteRuns, operation_id="reading_quiz_ai_runs")
async def quiz_runs(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    runs: AIRunServiceDependency,
) -> ReadingNoteRuns:
    await runs.authorize(db, context, workspace_id, request_id(request))
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    attempts = (
        select(QuizAttempt.id)
        .join(QuizItem, QuizItem.id == QuizAttempt.quiz_item_id)
        .where(
            QuizItem.resource_id == resource.id,
            QuizItem.research_owner_id == context.user.id,
            QuizAttempt.user_id == context.user.id,
        )
    )
    pairs = (
        await db.execute(
            select(AIRun, AIOutputDraft)
            .outerjoin(AIOutputDraft, AIOutputDraft.run_id == AIRun.id)
            .where(
                AIRun.workspace_id == workspace_id,
                AIRun.requested_by == context.user.id,
                (
                    (AIRun.target_type == "resource")
                    & (AIRun.target_id == resource.id)
                    & (AIRun.task_type == "quiz_generate")
                    & ((AIOutputDraft.status == "pending") | AIOutputDraft.id.is_(None))
                )
                | (
                    (AIRun.target_type == "quiz_attempt")
                    & AIRun.target_id.in_(attempts)
                    & (AIRun.task_type == "quiz_grade")
                ),
            )
            .order_by(AIRun.created_at.desc(), AIRun.id)
            .limit(20)
        )
    ).all()
    return ReadingNoteRuns(
        runs=[
            ResearchRunResult(run=run_response(run), draft=draft_response(draft) if draft else None)
            for run, draft in pairs
        ]
    )


@router.post(
    "/drafts/{draft_id}/decision",
    response_model=ReadingQuiz,
    operation_id="reading_quiz_draft_decide",
    dependencies=[Depends(write_boundary)],
)
async def decide_quiz_draft(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    draft_id: UUID,
    payload: ReadingQuizDecision,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    runs: AIRunServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ReadingQuiz:
    await run_write_boundary(
        request,
        context,
        identity,
        limiter,
        settings,
        workspace_id,
        x_csrf_token,
        require_recent=False,
    )
    await runs.authorize(db, context, workspace_id, request_id(request))
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    pair = (
        await db.execute(
            select(AIOutputDraft, AIRun)
            .join(AIRun, AIRun.id == AIOutputDraft.run_id)
            .where(
                AIOutputDraft.id == draft_id,
                AIOutputDraft.workspace_id == workspace_id,
                AIRun.workspace_id == workspace_id,
                AIRun.requested_by == context.user.id,
                AIRun.task_type == "quiz_generate",
                AIRun.status == "succeeded",
                AIRun.prompt_version == "research-v1/quiz_generate",
                AIRun.target_type == "resource",
                AIRun.target_id == resource.id,
                AIOutputDraft.target_type == "resource",
                AIOutputDraft.target_id == resource.id,
                AIOutputDraft.target_version == AIRun.target_version,
            )
            .with_for_update()
        )
    ).one_or_none()
    if pair is None:
        raise not_found()
    draft, run = pair
    if draft.status != "pending" or draft.version != payload.expected_draft_version:
        raise APIError(
            code="AI_DRAFT_TERMINAL",
            message="The draft was already decided or changed.",
            status_code=409,
        )
    if payload.decision == "accepted":
        if (
            resource.version != payload.expected_resource_version
            or resource.version != run.target_version
        ):
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The source changed since generation.",
                status_code=409,
            )
        if run.expected_output_fields != ["questions"]:
            raise APIError(
                code="AI_DRAFT_SCHEMA_INVALID",
                message="Unexpected quiz output fields.",
                status_code=422,
            )
        questions = parse_questions(draft.structured_output)
        count = await db.scalar(
            select(func.count(QuizItem.id)).where(
                QuizItem.resource_id == resource.id, QuizItem.deleted_at.is_(None)
            )
        )
        if (count or 0) + len(questions) > 100:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="A paper may contain at most 100 questions.",
                status_code=422,
            )
        for question in questions:
            topic = Topic(
                workspace_id=workspace_id,
                space_id=space_id,
                research_owner_id=context.user.id,
                title=question.concept,
                created_by=context.user.id,
                updated_by=context.user.id,
            )
            db.add(topic)
            await db.flush()
            db.add(
                QuizItem(
                    workspace_id=workspace_id,
                    space_id=space_id,
                    resource_id=resource.id,
                    research_owner_id=context.user.id,
                    topic_id=topic.id,
                    origin="ai",
                    ai_run_id=run.id,
                    prompt=question.prompt,
                    answer_key=question.answer_key,
                    explanation=question.explanation,
                    evaluation_mode="self_assessed",
                    created_by=context.user.id,
                    updated_by=context.user.id,
                )
            )
    draft.status, draft.decided_by, draft.decided_at = payload.decision, context.user.id, utc_now()
    draft.updated_at, draft.version = utc_now(), draft.version + 1
    service.audit(db, context, request_id(request), f"reading_quiz_draft_{payload.decision}")
    await db.flush()
    result = await quiz_response(db, resource)
    await db.commit()
    return result


@router.post(
    "/items/{item_id}/attempts",
    response_model=ReadingAttempt,
    operation_id="reading_quiz_attempt_create",
    dependencies=[Depends(prepare_submission), Depends(write_boundary)],
)
async def create_attempt(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    item_id: UUID,
    payload: ReadingAttemptCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingAttempt:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    item = await load_item(db, resource, item_id)
    if item.version != payload.expected_item_version:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT", message="The question changed.", status_code=409
        )
    previous = await db.get(QuizAttempt, payload.id)
    if previous is not None:
        if (
            previous.quiz_item_id == item.id
            and previous.user_id == context.user.id
            and previous.response_text == payload.response_text
            and previous.confidence == payload.confidence
            and previous.duration_seconds == payload.duration_seconds
            and previous.deleted_at is None
        ):
            result = attempt_response(previous)
            await consume_form_draft(db)
            await db.commit()
            return result
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT",
            message="The attempt identifier exists.",
            status_code=409,
        )
    count = await db.scalar(
        select(func.count(QuizAttempt.id)).where(
            QuizAttempt.quiz_item_id == item.id, QuizAttempt.user_id == context.user.id
        )
    )
    if (count or 0) >= 1000:
        raise APIError(
            code="RESOURCE_QUOTA_EXCEEDED",
            message="The attempt limit was reached.",
            status_code=422,
        )
    attempt = QuizAttempt(
        id=payload.id,
        workspace_id=workspace_id,
        space_id=space_id,
        topic_id=item.topic_id,
        quiz_item_id=item.id,
        user_id=context.user.id,
        response_text=payload.response_text,
        confidence=payload.confidence,
        duration_seconds=payload.duration_seconds,
        # Required by the legacy schema; private attempts never use this flag as a judgement.
        is_correct=False,
        created_by=context.user.id,
        updated_by=context.user.id,
    )
    db.add(attempt)
    service.audit(db, context, request_id(request), "reading_quiz_attempted")
    await db.flush()
    result = attempt_response(attempt)
    await consume_form_draft(db)
    await db.commit()
    return result


@router.get(
    "/items/{item_id}/answer",
    response_model=ReadingAnswer,
    operation_id="reading_quiz_answer_reveal",
)
async def reveal_answer(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    item_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingAnswer:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    item = await load_item(db, resource, item_id)
    return ReadingAnswer(answer_key=item.answer_key, explanation=item.explanation)


@router.post(
    "/items/{item_id}/mastery",
    response_model=MasteryConfirmationResponse,
    operation_id="reading_quiz_mastery_confirm",
    dependencies=[Depends(write_boundary)],
)
async def confirm_mastery(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    item_id: UUID,
    payload: MasteryConfirmRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    memory: MemoryServiceDependency,
) -> MasteryConfirmationResponse:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    item = await load_item(db, resource, item_id)
    topic = await db.scalar(
        select(Topic)
        .where(
            Topic.id == item.topic_id,
            Topic.research_owner_id == context.user.id,
            Topic.deleted_at.is_(None),
        )
        .with_for_update()
    )
    if topic is None:
        raise not_found()
    confirmation = await memory.confirm_locked_topic(
        db, context, topic, payload, request_id(request)
    )
    result = MasteryConfirmationResponse(
        mastery=mastery_response(confirmation.mastery),
        review_schedule=schedule_response(confirmation.review_schedule),
    )
    await db.commit()
    return result
