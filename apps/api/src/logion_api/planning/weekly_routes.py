from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from logion_api.ai_gateway.dependencies import AIRunServiceDependency
from logion_api.ai_gateway.models import AIOutputDraft, AIRun
from logion_api.ai_gateway.research_routes import ResearchRunResult
from logion_api.ai_gateway.run_routes import draft_response, run_response
from logion_api.db import utc_now
from logion_api.errors import ErrorResponse
from logion_api.form_drafts.service import consume as consume_form_draft
from logion_api.form_drafts.service import prepare_submission
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.service import not_found
from logion_api.planning.weekly_context import weekly_comment
from logion_api.planning.weekly_schemas import (
    ReadingTaskDecision,
    ReadingTaskFields,
    ReadingTaskUpdate,
    ReadingTaskView,
    WeeklyCommentAccept,
    WeeklyPlanView,
    WeeklyReviewClose,
    WeeklyReviewCreate,
    WeeklyReviewView,
    WeeklyVersion,
)
from logion_api.planning.weekly_service import WeeklyService, conflict, week_of

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/weekly",
    tags=["research-weekly"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


def get_weekly_service(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> WeeklyService:
    return WeeklyService(db, service, context, workspace_id, space_id, request_id(request))


Weekly = Annotated[WeeklyService, Depends(get_weekly_service)]


@router.get("", response_model=WeeklyPlanView, operation_id="research_weekly_get")
async def weekly_plan(week_start: date, service: Weekly) -> WeeklyPlanView:
    await service.authorize()
    week = week_of(week_start)
    review = await service.review(week)
    return WeeklyPlanView(
        week_start=week,
        tasks=[ReadingTaskView.model_validate(row) for row in await service.tasks(week)],
        review=WeeklyReviewView.model_validate(review) if review else None,
    )


@router.post(
    "/tasks",
    response_model=ReadingTaskView,
    status_code=201,
    operation_id="research_reading_task_create",
    dependencies=[Depends(write_boundary)],
)
async def create_task(payload: ReadingTaskFields, service: Weekly) -> ReadingTaskView:
    await service.authorize(write=True)
    row = await service.new_task(payload)
    service.audit("task_created")
    result = ReadingTaskView.model_validate(row)
    await service.db.commit()
    return result


@router.put(
    "/tasks/{task_id}",
    response_model=ReadingTaskView,
    operation_id="research_reading_task_update",
    dependencies=[Depends(write_boundary)],
)
async def update_task(
    task_id: UUID, payload: ReadingTaskUpdate, service: Weekly
) -> ReadingTaskView:
    await service.authorize(write=True)
    row = await service.get_task(task_id, payload.expected_version)
    if row.status == "done":
        raise conflict("READING_TASK_COMPLETED")
    assert row.scheduled_on is not None
    await service.open_week(
        payload.scheduled_on, extra=int(week_of(row.scheduled_on) != week_of(payload.scheduled_on))
    )
    await service.references(payload.goal_id, payload.resource_id)
    for key, value in payload.model_dump(exclude={"expected_version"}).items():
        setattr(row, key, value)
    service.touch(row)
    service.audit("task_updated")
    result = ReadingTaskView.model_validate(row)
    await service.db.commit()
    return result


@router.post(
    "/tasks/{task_id}/decision",
    response_model=ReadingTaskView,
    operation_id="research_reading_task_decide",
    dependencies=[Depends(write_boundary)],
)
async def decide_task(
    task_id: UUID, payload: ReadingTaskDecision, service: Weekly
) -> ReadingTaskView:
    await service.authorize(write=True)
    row = await service.get_task(task_id, payload.expected_version)
    await service.decide(row, payload)
    service.audit("task_decided")
    result = ReadingTaskView.model_validate(row)
    await service.db.commit()
    return result


@router.post(
    "/reviews",
    response_model=WeeklyReviewView,
    operation_id="research_weekly_review_create",
    dependencies=[Depends(write_boundary)],
)
async def create_review(payload: WeeklyReviewCreate, service: Weekly) -> WeeklyReviewView:
    await service.authorize(write=True)
    row = await service.create_review(payload)
    service.audit("review_created")
    result = WeeklyReviewView.model_validate(row)
    await service.db.commit()
    return result


@router.post(
    "/reviews/{review_id}/refresh",
    response_model=WeeklyReviewView,
    operation_id="research_weekly_review_refresh",
    dependencies=[Depends(write_boundary)],
)
async def refresh_review(
    review_id: UUID, payload: WeeklyVersion, service: Weekly
) -> WeeklyReviewView:
    await service.authorize(write=True)
    row = await service.get_review(review_id, payload.expected_version)
    await service.capture(row)
    service.touch(row)
    service.audit("review_refreshed")
    result = WeeklyReviewView.model_validate(row)
    await service.db.commit()
    return result


@router.post(
    "/reviews/{review_id}/close",
    response_model=WeeklyReviewView,
    operation_id="research_weekly_review_close",
    dependencies=[Depends(prepare_submission), Depends(write_boundary)],
)
async def close_review(
    review_id: UUID, payload: WeeklyReviewClose, service: Weekly
) -> WeeklyReviewView:
    await service.authorize(write=True)
    row = await service.get_review(review_id)
    await service.close(row, payload)
    service.audit("review_closed")
    result = WeeklyReviewView.model_validate(row)
    await consume_form_draft(service.db)
    await service.db.commit()
    return result


@router.post(
    "/reviews/{review_id}/comment",
    response_model=WeeklyReviewView,
    operation_id="research_weekly_comment_accept",
    dependencies=[Depends(write_boundary)],
)
async def accept_comment(
    review_id: UUID,
    payload: WeeklyCommentAccept,
    service: Weekly,
    runs: AIRunServiceDependency,
) -> WeeklyReviewView:
    await service.authorize(write=True)
    await runs.authorize(service.db, service.context, service.workspace_id, service.request_id)
    row = await service.get_review(review_id, payload.expected_version)
    if row.closed_at is not None:
        raise conflict("WEEKLY_REVIEW_CLOSED")
    pair = (
        await service.db.execute(
            select(AIOutputDraft, AIRun)
            .join(AIRun, AIRun.id == AIOutputDraft.run_id)
            .where(
                AIOutputDraft.id == payload.draft_id,
                AIOutputDraft.workspace_id == service.workspace_id,
                AIRun.workspace_id == service.workspace_id,
                AIRun.requested_by == service.user_id,
                AIRun.task_type == "weekly_comment",
                AIRun.target_type == "weekly_review",
                AIRun.target_id == row.id,
                AIRun.prompt_version == "research-v1/weekly_comment",
                AIRun.status == "succeeded",
                AIOutputDraft.target_type == "weekly_review",
                AIOutputDraft.target_id == row.id,
            )
            .with_for_update(of=AIOutputDraft)
        )
    ).one_or_none()
    if pair is None:
        raise not_found()
    draft, run = pair
    if draft.status != "pending" or draft.version != payload.expected_draft_version:
        raise conflict("AI_DRAFT_TERMINAL")
    if run.target_version != row.version or draft.target_version != row.version:
        raise conflict()
    row.ai_comment, row.ai_comment_run_id = weekly_comment(draft.structured_output), run.id
    service.touch(row)
    draft.status, draft.decided_by, draft.decided_at = "accepted", service.user_id, utc_now()
    draft.version += 1
    draft.updated_at = utc_now()
    service.audit("comment_accepted")
    result = WeeklyReviewView.model_validate(row)
    await service.db.commit()
    return result


@router.get(
    "/reviews/{review_id}/ai-runs",
    response_model=list[ResearchRunResult],
    operation_id="research_weekly_comment_runs",
)
async def comment_runs(
    review_id: UUID,
    service: Weekly,
    runs: AIRunServiceDependency,
) -> list[ResearchRunResult]:
    await service.authorize()
    await runs.authorize(service.db, service.context, service.workspace_id, service.request_id)
    row = await service.get_review(review_id)
    pairs = (
        await service.db.execute(
            select(AIRun, AIOutputDraft)
            .outerjoin(AIOutputDraft, AIOutputDraft.run_id == AIRun.id)
            .where(
                AIRun.workspace_id == service.workspace_id,
                AIRun.requested_by == service.user_id,
                AIRun.target_type == "weekly_review",
                AIRun.target_id == row.id,
                AIRun.task_type == "weekly_comment",
                AIRun.target_version == row.version,
                (AIOutputDraft.status == "pending") | AIOutputDraft.id.is_(None),
            )
            .order_by(AIRun.created_at.desc(), AIRun.id)
            .limit(10)
        )
    ).all()
    return [
        ResearchRunResult(run=run_response(run), draft=draft_response(draft) if draft else None)
        for run, draft in pairs
    ]
