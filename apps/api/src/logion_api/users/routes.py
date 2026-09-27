from typing import Annotated

from fastapi import APIRouter, Header, Query, Request, Response

from logion_api.errors import ErrorResponse
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
from logion_api.users.dependencies import UserSettingServiceDependency
from logion_api.users.models import UserSetting
from logion_api.users.research_preferences import (
    RESEARCH_SETTING_KEYS,
    require_research_settings_enabled,
    validate_research_preference,
)
from logion_api.users.schemas import (
    UserSettingBatchUpdate,
    UserSettingListResponse,
    UserSettingResponse,
)
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

router = APIRouter(prefix="/api/v1/users/me/settings", tags=["user-settings"])
ERROR = {"model": ErrorResponse}
SettingKeyQuery = Annotated[
    str | None,
    Query(min_length=1, max_length=128, pattern=r"^[a-z][a-z0-9_.-]*$"),
]


def response(rows: list[UserSetting]) -> UserSettingListResponse:
    return UserSettingListResponse(
        settings=[
            UserSettingResponse(key=row.key, value=row.value, version=row.version) for row in rows
        ]
    )


@router.get(
    "",
    response_model=UserSettingListResponse,
    operation_id="user_setting_list",
    responses={401: ERROR, 404: ERROR, 422: ERROR},
)
async def list_user_settings(
    context: AuthContextDependency,
    db: DatabaseSession,
    service: UserSettingServiceDependency,
    response_: Response,
    settings: SettingsDependency,
    key: SettingKeyQuery = None,
) -> UserSettingListResponse:
    response_.headers["Cache-Control"] = "no-store"
    require_research_settings_enabled(settings.research_v3_enabled, [key] if key else [])
    rows = await service.list_settings(db, context.user.id, key=key)
    if not settings.research_v3_enabled:
        rows = [row for row in rows if row.key not in RESEARCH_SETTING_KEYS]
    return response(rows)


@router.put(
    "",
    response_model=UserSettingListResponse,
    operation_id="user_setting_update",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR, 503: ERROR},
)
async def update_user_settings(
    payload: UserSettingBatchUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    service: UserSettingServiceDependency,
    response_: Response,
    workspaces: WorkspaceServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> UserSettingListResponse:
    require_trusted_origin(request, settings)
    identity.validate_csrf(
        context.session,
        x_csrf_token,
        request.cookies.get(settings.csrf_cookie_name),
    )
    subject = get_security().privacy_hash(str(context.user.id)) or "unknown"
    await limiter.enforce(
        scope="user_setting_write",
        subject_hash=subject,
        limit=settings.user_setting_write_limit_per_hour,
        window=3600,
    )
    try:
        require_research_settings_enabled(
            settings.research_v3_enabled, [update.key for update in payload.settings]
        )
        for update in payload.settings:
            preference = validate_research_preference(update.key, update.value)
            if preference is not None:
                await workspaces.resolve_space(
                    db,
                    context,
                    preference.workspace_id,
                    preference.space_id,
                    request_id=request_id(request),
                )
        rows = await service.update(db, context.user.id, payload.settings)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    response_.headers["Cache-Control"] = "no-store"
    return response(rows)
