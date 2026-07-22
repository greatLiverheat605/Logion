from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status

from logion_api.engagement.dependencies import EngagementServiceDependency
from logion_api.engagement.models import CalendarFeed, Notification, NotificationPreference
from logion_api.engagement.schemas import (
    CalendarFeedCreate,
    CalendarFeedCreated,
    CalendarFeedList,
    CalendarFeedResponse,
    CalendarFeedRevoke,
    NotificationList,
    NotificationPreferenceResponse,
    NotificationPreferenceUpdate,
    NotificationRead,
    NotificationResponse,
    SearchRequest,
    SearchResponse,
)
from logion_api.errors import APIError, ErrorResponse
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["engagement"])
public_router = APIRouter(prefix="/api/v1/calendars", tags=["public-calendar"])
ERROR = {"model": ErrorResponse}


def preference_response(
    workspace_id: UUID,
    user_id: UUID,
    row: NotificationPreference | None,
) -> NotificationPreferenceResponse:
    if row is None:
        return NotificationPreferenceResponse(
            workspace_id=workspace_id,
            user_id=user_id,
            enabled_categories=[
                "learning",
                "collaboration",
                "sync",
                "security",
                "ai",
                "billing",
                "system",
            ],
            timezone="UTC",
            quiet_start_minute=None,
            quiet_end_minute=None,
            version=0,
        )
    return NotificationPreferenceResponse(
        workspace_id=row.workspace_id,
        user_id=row.user_id,
        enabled_categories=row.enabled_categories,
        timezone=row.timezone,
        quiet_start_minute=row.quiet_start_minute,
        quiet_end_minute=row.quiet_end_minute,
        version=row.version,
    )


def notification_response(row: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        category=row.category,
        title=row.title,
        summary=row.summary,
        target_type=row.target_type,
        target_id=row.target_id,
        read_at=row.read_at,
        created_at=row.created_at,
    )


def feed_response(row: CalendarFeed) -> CalendarFeedResponse:
    return CalendarFeedResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        name=row.name,
        status=row.status,
        version=row.version,
        created_at=row.created_at,
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
    identity.require_recent_authentication(context)
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="engagement_write",
        subject_hash=subject,
        limit=settings.engagement_write_limit_per_hour,
        window=3600,
    )


@router.post(
    "/search",
    response_model=SearchResponse,
    operation_id="workspace_search",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 422: ERROR, 429: ERROR, 503: ERROR},
)
async def search(
    workspace_id: UUID,
    payload: SearchRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    engagement: EngagementServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SearchResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session, x_csrf_token, request.cookies.get(settings.csrf_cookie_name)
    )
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="workspace_search",
        subject_hash=subject,
        limit=settings.search_limit_per_minute,
        window=60,
    )
    rows = await engagement.search(db, context, workspace_id, payload, request_id(request))
    return SearchResponse(results=rows)


@router.get(
    "/notification-preferences",
    response_model=NotificationPreferenceResponse,
    operation_id="notification_preferences_get",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def get_preferences(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    engagement: EngagementServiceDependency,
) -> NotificationPreferenceResponse:
    row = await engagement.get_preferences(db, context, workspace_id, request_id(request))
    return preference_response(workspace_id, context.user.id, row)


@router.put(
    "/notification-preferences",
    response_model=NotificationPreferenceResponse,
    operation_id="notification_preferences_update",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def update_preferences(
    workspace_id: UUID,
    payload: NotificationPreferenceUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    engagement: EngagementServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> NotificationPreferenceResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await engagement.update_preferences(
            db, context, workspace_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return preference_response(workspace_id, context.user.id, row)


@router.get(
    "/notifications",
    response_model=NotificationList,
    operation_id="notification_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_notifications(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    engagement: EngagementServiceDependency,
) -> NotificationList:
    rows = await engagement.list_notifications(db, context, workspace_id, request_id(request))
    return NotificationList(notifications=[notification_response(row) for row in rows])


@router.post(
    "/notifications/{notification_id}/read",
    response_model=NotificationResponse,
    operation_id="notification_mark_read",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 422: ERROR, 429: ERROR},
)
async def mark_notification_read(
    workspace_id: UUID,
    notification_id: UUID,
    payload: NotificationRead,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    engagement: EngagementServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> NotificationResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await engagement.mark_read(
            db, context, workspace_id, notification_id, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return notification_response(row)


@router.get(
    "/calendar-feeds",
    response_model=CalendarFeedList,
    operation_id="calendar_feed_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_calendar_feeds(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    engagement: EngagementServiceDependency,
) -> CalendarFeedList:
    rows = await engagement.list_feeds(db, context, workspace_id, request_id(request))
    return CalendarFeedList(feeds=[feed_response(row) for row in rows])


@router.post(
    "/calendar-feeds",
    response_model=CalendarFeedCreated,
    status_code=status.HTTP_201_CREATED,
    operation_id="calendar_feed_create",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_calendar_feed(
    workspace_id: UUID,
    payload: CalendarFeedCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    engagement: EngagementServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CalendarFeedCreated:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row, token = await engagement.create_feed(
            db, context, workspace_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return CalendarFeedCreated(**feed_response(row).model_dump(), token=token)


@router.post(
    "/calendar-feeds/{feed_id}/revoke",
    response_model=CalendarFeedResponse,
    operation_id="calendar_feed_revoke",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def revoke_calendar_feed(
    workspace_id: UUID,
    feed_id: UUID,
    payload: CalendarFeedRevoke,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    engagement: EngagementServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CalendarFeedResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await engagement.revoke_feed(
            db,
            context,
            workspace_id,
            feed_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return feed_response(row)


@public_router.get(
    "/{token}.ics",
    operation_id="public_calendar_feed",
    response_class=Response,
    responses={404: ERROR, 429: ERROR, 503: ERROR},
)
async def get_public_calendar(
    request: Request,
    db: DatabaseSession,
    engagement: EngagementServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    token: str = Path(min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
) -> Response:
    subject = (
        get_security().privacy_hash(request.client.host if request.client else None) or "unknown"
    )
    await limiter.enforce(
        scope="public_calendar_read",
        subject_hash=subject,
        limit=settings.public_calendar_read_limit_per_minute,
        window=60,
    )
    value = await engagement.render_calendar(db, token)
    return Response(
        content=value,
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"},
    )
