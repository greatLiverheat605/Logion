from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from logion_api.ai_gateway.dependencies import (
    AIProviderDiscoveryAdapterDependency,
    AIProviderServiceDependency,
)
from logion_api.ai_gateway.models import AIModel, AIProvider
from logion_api.ai_gateway.schemas import (
    AIModelDiscoveryResponse,
    AIModelList,
    AIModelResponse,
    AIProviderCreate,
    AIProviderDelete,
    AIProviderList,
    AIProviderResponse,
    AIProviderUpdate,
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

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/ai/providers", tags=["ai"])
model_router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/ai/models", tags=["ai"])
ERROR = {"model": ErrorResponse}


def provider_response(provider: AIProvider) -> AIProviderResponse:
    return AIProviderResponse(
        id=provider.id,
        workspace_id=provider.workspace_id,
        name=provider.name,
        provider_type="openai_compatible",
        base_url=provider.base_url,
        credential_configured=provider.credential_ciphertext is not None,
        enabled=provider.enabled,
        timeout_seconds=provider.timeout_seconds,
        max_retries=provider.max_retries,
        last_health_status=provider.last_health_status,
        last_health_checked_at=provider.last_health_checked_at,
        last_health_error_code=provider.last_health_error_code,
        version=provider.version,
    )


def model_response(model: AIModel) -> AIModelResponse:
    return AIModelResponse(
        id=model.id,
        workspace_id=model.workspace_id,
        provider_id=model.provider_id,
        provider_model_id=model.provider_model_id,
        display_name=model.display_name,
        source=model.source,
        enabled=model.enabled,
        supports_json=model.supports_json,
        supports_stream=model.supports_stream,
        context_window=model.context_window,
        version=model.version,
        last_seen_at=model.last_seen_at,
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
        scope="ai_provider_write",
        subject_hash=subject,
        limit=settings.ai_provider_write_limit_per_hour,
        window=3600,
    )


async def discovery_boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    provider_id: UUID,
    csrf: str | None,
) -> None:
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, csrf, request.cookies.get(settings.csrf_cookie_name))
    identity.require_recent_authentication(context)
    subject = (
        get_security().privacy_hash(f"{workspace_id}:{provider_id}:{context.user.id}") or "unknown"
    )
    await limiter.enforce(
        scope="ai_provider_discovery",
        subject_hash=subject,
        limit=settings.ai_provider_discovery_limit_per_hour,
        window=3600,
    )


@router.get(
    "",
    response_model=AIProviderList,
    operation_id="ai_provider_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_providers(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    providers: AIProviderServiceDependency,
) -> AIProviderList:
    try:
        rows = await providers.list_providers(db, context, workspace_id, request_id(request))
    except APIError:
        await db.commit()
        raise
    return AIProviderList(providers=[provider_response(row) for row in rows])


@model_router.get(
    "",
    response_model=AIModelList,
    operation_id="ai_model_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_models(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    providers: AIProviderServiceDependency,
) -> AIModelList:
    try:
        rows = await providers.list_models(db, context, workspace_id, request_id(request))
    except APIError:
        await db.commit()
        raise
    return AIModelList(models=[model_response(row) for row in rows])


@router.post(
    "/{provider_id}/discover-models",
    response_model=AIModelDiscoveryResponse,
    operation_id="ai_provider_discover_models",
    responses={
        401: ERROR,
        403: ERROR,
        404: ERROR,
        409: ERROR,
        422: ERROR,
        429: ERROR,
        503: ERROR,
    },
)
async def discover_models(
    workspace_id: UUID,
    provider_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    providers: AIProviderServiceDependency,
    adapter: AIProviderDiscoveryAdapterDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIModelDiscoveryResponse:
    await discovery_boundary(
        request,
        context,
        identity,
        limiter,
        settings,
        workspace_id,
        provider_id,
        x_csrf_token,
    )
    try:
        rows = await providers.discover_models(
            db,
            context,
            workspace_id,
            provider_id,
            adapter,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return AIModelDiscoveryResponse(
        provider_id=provider_id,
        health_status="healthy",
        model_count=len(rows),
        models=[model_response(row) for row in rows],
    )


@router.post(
    "",
    response_model=AIProviderResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="ai_provider_create",
    responses={
        401: ERROR,
        403: ERROR,
        404: ERROR,
        409: ERROR,
        422: ERROR,
        429: ERROR,
        503: ERROR,
    },
)
async def create_provider(
    workspace_id: UUID,
    payload: AIProviderCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    providers: AIProviderServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIProviderResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await providers.create(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return provider_response(row)


@router.put(
    "/{provider_id}",
    response_model=AIProviderResponse,
    operation_id="ai_provider_update",
    responses={
        401: ERROR,
        403: ERROR,
        404: ERROR,
        409: ERROR,
        422: ERROR,
        429: ERROR,
        503: ERROR,
    },
)
async def update_provider(
    workspace_id: UUID,
    provider_id: UUID,
    payload: AIProviderUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    providers: AIProviderServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIProviderResponse:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        row = await providers.update(
            db, context, workspace_id, provider_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return provider_response(row)


@router.delete(
    "/{provider_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="ai_provider_delete",
    responses={
        401: ERROR,
        403: ERROR,
        404: ERROR,
        409: ERROR,
        422: ERROR,
        429: ERROR,
        503: ERROR,
    },
)
async def delete_provider(
    workspace_id: UUID,
    provider_id: UUID,
    payload: AIProviderDelete,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    providers: AIProviderServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> Response:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        await providers.delete(
            db,
            context,
            workspace_id,
            provider_id,
            payload.expected_version,
            request_id(request),
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)
