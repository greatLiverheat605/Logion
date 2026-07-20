from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response

from logion_api.audit.dependencies import AuditQueryServiceDependency
from logion_api.audit.schemas import AuditEventPageResponse, AuditEventResponse
from logion_api.audit.service import AuditPage
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    RateLimiterDependency,
    SettingsDependency,
    get_security,
    request_id,
)
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.permissions import Permission

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])
workspace_router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/audit-events",
    tags=["audit"],
)
ERROR_RESPONSE = {"model": ErrorResponse}
EventTypeFilter = Annotated[
    str | None,
    Query(min_length=1, max_length=80, pattern=r"^[a-z0-9_.]+$"),
]
ResultFilter = Annotated[
    str | None,
    Query(min_length=1, max_length=32, pattern=r"^[a-z_]+$"),
]
CursorFilter = Annotated[str | None, Query(min_length=1, max_length=1024)]
PageSize = Annotated[int, Query(ge=1, le=100)]
DateFilter = Annotated[datetime | None, Query()]


def _page_response(page: AuditPage) -> AuditEventPageResponse:
    return AuditEventPageResponse(
        events=[
            AuditEventResponse(
                id=event.id,
                event_type=event.event_type,
                result=event.result,
                actor_id=event.actor_id,
                target_type=event.target_type,
                target_id=event.target_id,
                occurred_at=event.occurred_at,
            )
            for event in page.events
        ],
        next_cursor=page.next_cursor,
    )


async def _enforce_rate_limit(
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    identity: str,
) -> None:
    await limiter.enforce(
        scope="audit_query",
        subject_hash=get_security().privacy_hash(identity) or "unknown",
        limit=settings.audit_query_limit_per_minute,
        window=60,
    )


@router.get(
    "/me",
    response_model=AuditEventPageResponse,
    operation_id="audit_personal_identity_list",
    responses={400: ERROR_RESPONSE, 401: ERROR_RESPONSE, 422: ERROR_RESPONSE, 429: ERROR_RESPONSE},
)
async def list_personal_identity_audit(
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    audit: AuditQueryServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    page_size: PageSize = 50,
    cursor: CursorFilter = None,
    event_type: EventTypeFilter = None,
    result: ResultFilter = None,
    occurred_after: DateFilter = None,
    occurred_before: DateFilter = None,
) -> AuditEventPageResponse:
    await _enforce_rate_limit(limiter, settings, f"user:{context.user.id}")
    page = await audit.list_personal_identity_events(
        db,
        context.user.id,
        page_size=page_size,
        cursor=cursor,
        event_type=event_type,
        result=result,
        occurred_after=occurred_after,
        occurred_before=occurred_before,
    )
    response.headers["Cache-Control"] = "no-store"
    return _page_response(page)


@workspace_router.get(
    "",
    response_model=AuditEventPageResponse,
    operation_id="audit_workspace_list",
    responses={
        400: ERROR_RESPONSE,
        401: ERROR_RESPONSE,
        403: ERROR_RESPONSE,
        404: ERROR_RESPONSE,
        422: ERROR_RESPONSE,
        429: ERROR_RESPONSE,
    },
)
async def list_workspace_audit(
    workspace_id: UUID,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    audit: AuditQueryServiceDependency,
    workspaces: WorkspaceServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    page_size: PageSize = 50,
    cursor: CursorFilter = None,
    event_type: EventTypeFilter = None,
    result: ResultFilter = None,
    occurred_after: DateFilter = None,
    occurred_before: DateFilter = None,
) -> AuditEventPageResponse:
    await _enforce_rate_limit(limiter, settings, f"user:{context.user.id}")
    try:
        await workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id(request),
            permission=Permission.WORKSPACE_MANAGE_SECURITY,
        )
    except APIError:
        await db.commit()
        raise
    page = await audit.list_workspace_events(
        db,
        workspace_id,
        page_size=page_size,
        cursor=cursor,
        event_type=event_type,
        result=result,
        occurred_after=occurred_after,
        occurred_before=occurred_before,
    )
    response.headers["Cache-Control"] = "no-store"
    return _page_response(page)
