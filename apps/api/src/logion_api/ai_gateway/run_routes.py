from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.ai_gateway.dependencies import AIRunServiceDependency
from logion_api.ai_gateway.models import AIOutputDraft, AIRun
from logion_api.ai_gateway.routes import ERROR
from logion_api.ai_gateway.run_schemas import (
    AIOutputDraftDecision,
    AIOutputDraftList,
    AIOutputDraftResponse,
    AIRunCancel,
    AIRunCreate,
    AIRunList,
    AIRunResponse,
)
from logion_api.errors import APIError
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/ai", tags=["ai"])


async def run_write_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    csrf: str | None,
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, csrf, request.cookies.get(settings.csrf_cookie_name))
    identity.require_recent_authentication(context)
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="ai_run_write",
        subject_hash=subject,
        limit=settings.ai_run_write_limit_per_hour,
        window=3600,
    )


def run_response(run: AIRun) -> AIRunResponse:
    return AIRunResponse(
        id=run.id,
        workspace_id=run.workspace_id,
        route_id=run.route_id,
        task_type=run.task_type,
        target_type=run.target_type,
        target_id=run.target_id,
        target_version=run.target_version,
        selected_fields=run.selected_fields,
        expected_output_fields=run.expected_output_fields,
        retain_input=run.retain_input,
        status=run.status,
        estimated_input_tokens=run.estimated_input_tokens,
        requested_output_tokens=run.requested_output_tokens,
        reserved_tokens=run.reserved_tokens,
        reserved_cost_minor=run.reserved_cost_minor,
        actual_input_tokens=run.actual_input_tokens,
        actual_output_tokens=run.actual_output_tokens,
        actual_cost_minor=run.actual_cost_minor,
        currency=run.currency,
        attempt_count=run.attempt_count,
        selected_model_id=run.selected_model_id,
        selected_provider_id=run.selected_provider_id,
        selected_candidate_position=run.selected_candidate_position,
        error_code=run.error_code,
        cancel_requested_at=run.cancel_requested_at,
        version=run.version,
        created_at=run.created_at,
        started_at=run.started_at,
        completed_at=run.completed_at,
    )


def draft_response(draft: AIOutputDraft) -> AIOutputDraftResponse:
    return AIOutputDraftResponse(
        id=draft.id,
        workspace_id=draft.workspace_id,
        run_id=draft.run_id,
        target_type=draft.target_type,
        target_id=draft.target_id,
        target_version=draft.target_version,
        structured_output=draft.structured_output,
        edited_output=draft.edited_output,
        status=draft.status,
        decision_note=draft.decision_note,
        version=draft.version,
        created_at=draft.created_at,
        decided_at=draft.decided_at,
    )


@router.get(
    "/runs",
    response_model=AIRunList,
    operation_id="ai_run_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_runs(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    runs: AIRunServiceDependency,
) -> AIRunList:
    rows = await runs.list_runs(db, context, workspace_id, request_id(request))
    return AIRunList(runs=[run_response(row) for row in rows])


@router.post(
    "/runs",
    response_model=AIRunResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="ai_run_create",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR, 503: ERROR},
)
async def create_run(
    workspace_id: UUID,
    payload: AIRunCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    runs: AIRunServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIRunResponse:
    await run_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        run = await runs.create(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return run_response(run)


@router.post(
    "/runs/{run_id}/cancel",
    response_model=AIRunResponse,
    operation_id="ai_run_cancel",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR, 503: ERROR},
)
async def cancel_run(
    workspace_id: UUID,
    run_id: UUID,
    payload: AIRunCancel,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    runs: AIRunServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIRunResponse:
    await run_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        run = await runs.cancel(
            db, context, workspace_id, run_id, payload.expected_version, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return run_response(run)


@router.get(
    "/drafts",
    response_model=AIOutputDraftList,
    operation_id="ai_draft_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_drafts(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    runs: AIRunServiceDependency,
) -> AIOutputDraftList:
    rows = await runs.list_drafts(db, context, workspace_id, request_id(request))
    return AIOutputDraftList(drafts=[draft_response(row) for row in rows])


@router.post(
    "/drafts/{draft_id}/decision",
    response_model=AIOutputDraftResponse,
    operation_id="ai_draft_decide",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def decide_draft(
    workspace_id: UUID,
    draft_id: UUID,
    payload: AIOutputDraftDecision,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    runs: AIRunServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIOutputDraftResponse:
    await run_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        draft = await runs.decide_draft(
            db, context, workspace_id, draft_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return draft_response(draft)
