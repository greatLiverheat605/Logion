from uuid import UUID

from fastapi import APIRouter, Header, Path, Request, Response, status

from logion_api.errors import APIError, ErrorResponse
from logion_api.growth.dependencies import GrowthServiceDependency
from logion_api.growth.models import ShareSnapshot, TemplateInstallation, TemplatePackage
from logion_api.growth.schemas import (
    PublicShareResponse,
    ShareSnapshotCreate,
    ShareSnapshotCreated,
    ShareSnapshotList,
    ShareSnapshotResponse,
    ShareSnapshotRevoke,
    TemplateFromGoalCreate,
    TemplateInstall,
    TemplateInstallationResponse,
    TemplatePackageImport,
    TemplatePackageList,
    TemplatePackageResponse,
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}", tags=["growth"])
public_router = APIRouter(prefix="/api/v1/shares", tags=["public-share"])
ERROR = {"model": ErrorResponse}


def template_response(row: TemplatePackage) -> TemplatePackageResponse:
    return TemplatePackageResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        template_key=row.template_key,
        version_number=row.version_number,
        name=row.name,
        description=row.description,
        schema_version=row.schema_version,
        product_min_version=row.product_min_version,
        author_name=row.author_name,
        license=row.license,
        locale=row.locale,
        target_personas=row.target_personas,
        changelog=row.changelog,
        content_hash=row.content_hash,
        risk_metadata=row.risk_metadata,
        object_graph=row.object_graph,
        visibility=row.visibility,
        status=row.status,
        created_at=row.created_at,
    )


def installation_response(row: TemplateInstallation) -> TemplateInstallationResponse:
    return TemplateInstallationResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        space_id=row.space_id,
        template_id=row.template_id,
        template_content_hash=row.template_content_hash,
        installed_object_ids=row.installed_object_ids,
        created_at=row.created_at,
    )


def share_response(row: ShareSnapshot) -> ShareSnapshotResponse:
    return ShareSnapshotResponse(
        id=row.id,
        workspace_id=row.workspace_id,
        space_id=row.space_id,
        object_type="goal_plan",
        object_id=row.object_id,
        title=row.title,
        status=row.status,
        version=row.version,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


async def growth_boundary(
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
        scope="growth_write",
        subject_hash=subject,
        limit=settings.growth_write_limit_per_hour,
        window=3600,
    )


@router.get(
    "/templates",
    response_model=TemplatePackageList,
    operation_id="template_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_templates(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    growth: GrowthServiceDependency,
) -> TemplatePackageList:
    rows = await growth.list_templates(db, context, workspace_id, request_id(request))
    return TemplatePackageList(templates=[template_response(row) for row in rows])


@router.post(
    "/templates/from-goal",
    response_model=TemplatePackageResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="template_create_from_goal",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_template(
    workspace_id: UUID,
    payload: TemplateFromGoalCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    growth: GrowthServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TemplatePackageResponse:
    await growth_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await growth.create_template(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return template_response(row)


@router.post(
    "/templates/import",
    response_model=TemplatePackageResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="template_import",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def import_template(
    workspace_id: UUID,
    payload: TemplatePackageImport,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    growth: GrowthServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TemplatePackageResponse:
    await growth_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await growth.import_template(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.rollback()
        raise
    return template_response(row)


@router.post(
    "/template-installations",
    response_model=TemplateInstallationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="template_install",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def install_template(
    workspace_id: UUID,
    payload: TemplateInstall,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    growth: GrowthServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TemplateInstallationResponse:
    await growth_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await growth.install_template(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.rollback()
        raise
    return installation_response(row)


@router.get(
    "/shares",
    response_model=ShareSnapshotList,
    operation_id="share_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_shares(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    growth: GrowthServiceDependency,
) -> ShareSnapshotList:
    rows = await growth.list_shares(db, context, workspace_id, request_id(request))
    return ShareSnapshotList(shares=[share_response(row) for row in rows])


@router.post(
    "/shares",
    response_model=ShareSnapshotCreated,
    status_code=status.HTTP_201_CREATED,
    operation_id="share_create",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_share(
    workspace_id: UUID,
    payload: ShareSnapshotCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    growth: GrowthServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ShareSnapshotCreated:
    await growth_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row, token = await growth.create_share(
            db, context, workspace_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return ShareSnapshotCreated(**share_response(row).model_dump(), token=token)


@router.post(
    "/shares/{share_id}/revoke",
    response_model=ShareSnapshotResponse,
    operation_id="share_revoke",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def revoke_share(
    workspace_id: UUID,
    share_id: UUID,
    payload: ShareSnapshotRevoke,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    growth: GrowthServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ShareSnapshotResponse:
    await growth_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await growth.revoke_share(
            db,
            context,
            workspace_id,
            share_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return share_response(row)


@public_router.get(
    "/{token}",
    response_model=PublicShareResponse,
    operation_id="public_share_get",
    responses={404: ERROR, 429: ERROR, 503: ERROR},
)
async def get_public_share(
    request: Request,
    response: Response,
    db: DatabaseSession,
    growth: GrowthServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    token: str = Path(min_length=32, max_length=128, pattern=r"^[A-Za-z0-9_-]+$"),
) -> PublicShareResponse:
    subject = (
        get_security().privacy_hash(request.client.host if request.client else None) or "unknown"
    )
    await limiter.enforce(
        scope="public_share_read",
        subject_hash=subject,
        limit=settings.public_share_read_limit_per_minute,
        window=60,
    )
    row = await growth.public_share(db, token)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return PublicShareResponse(
        title=row.title,
        object_type="goal_plan",
        snapshot=row.snapshot,
        expires_at=row.expires_at,
    )
