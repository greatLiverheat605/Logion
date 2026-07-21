from typing import Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.errors import ErrorResponse
from logion_api.execution.dependencies import ExecutionServiceDependency
from logion_api.execution.models import StudySession, Task
from logion_api.execution.schemas import (
    SessionFinishRequest,
    SessionResponse,
    SessionStartRequest,
    TaskCreateRequest,
    TaskResponse,
    TaskStatus,
    TaskTransitionRequest,
)
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}", tags=["execution"])
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


def task_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        workspace_id=task.workspace_id,
        space_id=task.space_id,
        goal_id=task.goal_id,
        phase_id=task.phase_id,
        title=task.title,
        description=task.description,
        status=cast(TaskStatus, task.status),
        priority=task.priority,
        estimated_minutes=task.estimated_minutes,
        planned_at=task.planned_at,
        due_at=task.due_at,
        blocked_reason=task.blocked_reason,
        version=task.version,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def session_response(session: StudySession) -> SessionResponse:
    return SessionResponse(
        id=session.id,
        workspace_id=session.workspace_id,
        space_id=session.space_id,
        task_id=session.task_id,
        status=cast(Literal["active", "completed", "abandoned"], session.status),
        started_at=session.started_at,
        ended_at=session.ended_at,
        manual_minutes=session.manual_minutes,
        reflection=session.reflection,
        version=session.version,
    )


async def write_boundary(
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
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="execution_write",
        subject_hash=subject,
        limit=settings.execution_write_limit_per_hour,
        window=3600,
    )


@router.post(
    "/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="task_create",
    responses=ERRORS,
)
async def create_task(
    workspace_id: UUID,
    space_id: UUID,
    payload: TaskCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    execution: ExecutionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TaskResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    task = await execution.create_task(
        db,
        context,
        workspace_id,
        space_id,
        task_id=payload.id,
        goal_id=payload.goal_id,
        phase_id=payload.phase_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        estimated_minutes=payload.estimated_minutes,
        planned_at=payload.planned_at,
        due_at=payload.due_at,
        request_id=request_id(request),
    )
    await db.commit()
    return task_response(task)


@router.post(
    "/tasks/{task_id}/transition",
    response_model=TaskResponse,
    operation_id="task_transition",
    responses=ERRORS,
)
async def transition_task(
    workspace_id: UUID,
    space_id: UUID,
    task_id: UUID,
    payload: TaskTransitionRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    execution: ExecutionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TaskResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    task = await execution.transition_task(
        db,
        context,
        workspace_id,
        space_id,
        task_id,
        expected_version=payload.expected_version,
        desired_status=payload.status,
        blocked_reason=payload.blocked_reason,
        request_id=request_id(request),
    )
    await db.commit()
    return task_response(task)


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="study_session_start",
    responses=ERRORS,
)
async def start_session(
    workspace_id: UUID,
    space_id: UUID,
    payload: SessionStartRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    execution: ExecutionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SessionResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    session = await execution.start_session(
        db,
        context,
        workspace_id,
        space_id,
        session_id=payload.id,
        task_id=payload.task_id,
        request_id=request_id(request),
    )
    await db.commit()
    return session_response(session)


@router.post(
    "/sessions/{session_id}/finish",
    response_model=SessionResponse,
    operation_id="study_session_finish",
    responses=ERRORS,
)
async def finish_session(
    workspace_id: UUID,
    space_id: UUID,
    session_id: UUID,
    payload: SessionFinishRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    execution: ExecutionServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SessionResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    session = await execution.finish_session(
        db,
        context,
        workspace_id,
        space_id,
        session_id,
        expected_version=payload.expected_version,
        outcome=payload.outcome,
        manual_minutes=payload.manual_minutes,
        reflection=payload.reflection,
        request_id=request_id(request),
    )
    await db.commit()
    return session_response(session)
