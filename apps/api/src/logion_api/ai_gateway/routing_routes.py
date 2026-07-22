from uuid import UUID

from fastapi import APIRouter, Header, Request, Response, status

from logion_api.ai_gateway.dependencies import AIRoutingServiceDependency
from logion_api.ai_gateway.models import AITaskRoute, AIWorkspaceBudget
from logion_api.ai_gateway.routes import ERROR, model_response, write_boundary
from logion_api.ai_gateway.routing_schemas import (
    AIModelCreate,
    AIModelUpdate,
    AIRouteResolveRequest,
    AIRouteResolveResponse,
    AITaskRouteCreate,
    AITaskRouteDelete,
    AITaskRouteList,
    AITaskRouteResponse,
    AITaskRouteUpdate,
    AIWorkspaceBudgetResponse,
    AIWorkspaceBudgetUpdate,
)
from logion_api.ai_gateway.run_routes import run_write_boundary
from logion_api.ai_gateway.schemas import AIModelResponse
from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.workspaces.permissions import Permission

router = APIRouter(prefix="/api/v1/workspaces/{workspace_id}/ai", tags=["ai"])


def budget_response(
    workspace_id: UUID, budget: AIWorkspaceBudget | None
) -> AIWorkspaceBudgetResponse:
    if budget is None:
        return AIWorkspaceBudgetResponse(
            workspace_id=workspace_id,
            monthly_token_budget=None,
            monthly_cost_budget_minor=None,
            currency="USD",
            version=0,
        )
    return AIWorkspaceBudgetResponse(
        workspace_id=workspace_id,
        monthly_token_budget=budget.monthly_token_budget,
        monthly_cost_budget_minor=budget.monthly_cost_budget_minor,
        currency=budget.currency,
        version=budget.version,
    )


def route_response(route: AITaskRoute, model_ids: list[UUID]) -> AITaskRouteResponse:
    return AITaskRouteResponse(
        id=route.id,
        workspace_id=route.workspace_id,
        name=route.name,
        task_type=route.task_type,
        requires_json=route.requires_json,
        requires_stream=route.requires_stream,
        max_input_tokens=route.max_input_tokens,
        max_output_tokens=route.max_output_tokens,
        enabled=route.enabled,
        model_ids=model_ids,
        version=route.version,
    )


async def boundary(
    request: Request,
    context: AuthContextDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    csrf: str | None,
) -> None:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, csrf)


@router.post(
    "/models",
    response_model=AIModelResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="ai_model_create_manual",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_model(
    workspace_id: UUID,
    payload: AIModelCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIModelResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        model = await routing.create_model(db, context, workspace_id, payload, request_id(request))
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return model_response(model)


@router.put(
    "/models/{model_id}",
    response_model=AIModelResponse,
    operation_id="ai_model_update",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def update_model(
    workspace_id: UUID,
    model_id: UUID,
    payload: AIModelUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIModelResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        model = await routing.update_model(
            db, context, workspace_id, model_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return model_response(model)


@router.get(
    "/budget",
    response_model=AIWorkspaceBudgetResponse,
    operation_id="ai_budget_get",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def get_budget(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    routing: AIRoutingServiceDependency,
) -> AIWorkspaceBudgetResponse:
    budget = await routing.get_budget(db, context, workspace_id, request_id(request))
    return budget_response(workspace_id, budget)


@router.put(
    "/budget",
    response_model=AIWorkspaceBudgetResponse,
    operation_id="ai_budget_update",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def update_budget(
    workspace_id: UUID,
    payload: AIWorkspaceBudgetUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIWorkspaceBudgetResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        budget = await routing.update_budget(
            db, context, workspace_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return budget_response(workspace_id, budget)


@router.get(
    "/routes",
    response_model=AITaskRouteList,
    operation_id="ai_route_list",
    responses={401: ERROR, 403: ERROR, 404: ERROR},
)
async def list_routes(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    routing: AIRoutingServiceDependency,
) -> AITaskRouteList:
    rows = await routing.list_routes(db, context, workspace_id, request_id(request))
    return AITaskRouteList(routes=[route_response(route, models) for route, models in rows])


@router.post(
    "/routes",
    response_model=AITaskRouteResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="ai_route_create",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def create_route(
    workspace_id: UUID,
    payload: AITaskRouteCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AITaskRouteResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        route, models = await routing.create_route(
            db, context, workspace_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return route_response(route, models)


@router.put(
    "/routes/{route_id}",
    response_model=AITaskRouteResponse,
    operation_id="ai_route_update",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def update_route(
    workspace_id: UUID,
    route_id: UUID,
    payload: AITaskRouteUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AITaskRouteResponse:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        route, models = await routing.update_route(
            db, context, workspace_id, route_id, payload, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return route_response(route, models)


@router.delete(
    "/routes/{route_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="ai_route_delete",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR},
)
async def delete_route(
    workspace_id: UUID,
    route_id: UUID,
    payload: AITaskRouteDelete,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> Response:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    try:
        await routing.delete_route(
            db, context, workspace_id, route_id, payload.expected_version, request_id(request)
        )
        await db.commit()
    except APIError:
        await db.commit()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/route-resolution-preview",
    response_model=AIRouteResolveResponse,
    operation_id="ai_route_resolve_preview",
    responses={401: ERROR, 403: ERROR, 404: ERROR, 409: ERROR, 422: ERROR, 429: ERROR, 503: ERROR},
)
async def resolve_route(
    workspace_id: UUID,
    payload: AIRouteResolveRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    routing: AIRoutingServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIRouteResolveResponse:
    await run_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    route, candidates, budget = await routing.resolve(
        db,
        context,
        workspace_id,
        payload,
        request_id(request),
        permission=Permission.AI_USE,
    )
    return AIRouteResolveResponse(
        route_id=route.id,
        task_type=route.task_type,
        candidates=candidates,
        monthly_token_budget=budget.monthly_token_budget if budget else None,
        monthly_cost_budget_minor=budget.monthly_cost_budget_minor if budget else None,
        currency=budget.currency if budget else candidates[0].currency,
    )
