import math
import unicodedata
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.models import (
    AIModel,
    AIProvider,
    AITaskRoute,
    AITaskRouteTarget,
    AIWorkspaceBudget,
)
from logion_api.ai_gateway.routing_schemas import (
    AIModelCreate,
    AIModelUpdate,
    AIRouteCandidate,
    AIRouteResolveRequest,
    AITaskRouteCreate,
    AITaskRouteUpdate,
    AIWorkspaceBudgetUpdate,
)
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent
from logion_api.identity.service import AuthContext
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


class AIRoutingService:
    def __init__(self, workspaces: WorkspaceService) -> None:
        self._workspaces = workspaces

    async def authorize(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        request_id: str,
        permission: Permission = Permission.AI_CONFIGURE,
    ) -> None:
        await self._workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=permission,
        )

    async def create_model(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: AIModelCreate,
        request_id: str,
    ) -> AIModel:
        await self.authorize(db, context, workspace_id, request_id)
        provider = await db.scalar(
            select(AIProvider).where(
                AIProvider.id == payload.provider_id,
                AIProvider.workspace_id == workspace_id,
                AIProvider.deleted_at.is_(None),
            )
        )
        if provider is None:
            raise self._not_found("AI Provider")
        if await db.get(AIModel, payload.id) is not None:
            raise self._conflict("Identifier exists.")
        model = AIModel(
            id=payload.id,
            workspace_id=workspace_id,
            provider_id=payload.provider_id,
            provider_model_id=payload.provider_model_id,
            display_name=payload.display_name,
            source="manual",
            enabled=payload.enabled,
            supports_json=payload.supports_json,
            supports_stream=payload.supports_stream,
            context_window=payload.context_window,
            pricing_currency=payload.pricing_currency,
            input_cost_per_million_minor=payload.input_cost_per_million_minor,
            output_cost_per_million_minor=payload.output_cost_per_million_minor,
            last_seen_at=utc_now(),
        )
        try:
            async with db.begin_nested():
                db.add(model)
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("The Provider model ID already exists.") from exc
        db.add(self._audit(context, workspace_id, request_id, "ai.model_created", model.id))
        return model

    async def update_model(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        model_id: UUID,
        payload: AIModelUpdate,
        request_id: str,
    ) -> AIModel:
        await self.authorize(db, context, workspace_id, request_id)
        model = await self._model(db, workspace_id, model_id, lock=True)
        if model.version != payload.expected_version:
            raise self._conflict("The AI model changed.")
        model.display_name = payload.display_name
        model.enabled = payload.enabled
        model.supports_json = payload.supports_json
        model.supports_stream = payload.supports_stream
        model.context_window = payload.context_window
        model.pricing_currency = payload.pricing_currency
        model.input_cost_per_million_minor = payload.input_cost_per_million_minor
        model.output_cost_per_million_minor = payload.output_cost_per_million_minor
        model.version += 1
        model.updated_at = utc_now()
        db.add(self._audit(context, workspace_id, request_id, "ai.model_updated", model.id))
        await db.flush()
        return model

    async def get_budget(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> AIWorkspaceBudget | None:
        await self.authorize(db, context, workspace_id, request_id)
        return await db.get(AIWorkspaceBudget, workspace_id)

    async def update_budget(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: AIWorkspaceBudgetUpdate,
        request_id: str,
    ) -> AIWorkspaceBudget:
        await self.authorize(db, context, workspace_id, request_id)
        budget = await db.scalar(
            select(AIWorkspaceBudget)
            .where(AIWorkspaceBudget.workspace_id == workspace_id)
            .with_for_update()
        )
        try:
            async with db.begin_nested():
                if budget is None:
                    if payload.expected_version is not None:
                        raise self._conflict("The AI budget does not exist.")
                    budget = AIWorkspaceBudget(
                        workspace_id=workspace_id,
                        monthly_token_budget=payload.monthly_token_budget,
                        monthly_cost_budget_minor=payload.monthly_cost_budget_minor,
                        currency=payload.currency,
                        updated_by=context.user.id,
                    )
                    db.add(budget)
                else:
                    if budget.version != payload.expected_version:
                        raise self._conflict("The AI budget changed.")
                    budget.monthly_token_budget = payload.monthly_token_budget
                    budget.monthly_cost_budget_minor = payload.monthly_cost_budget_minor
                    budget.currency = payload.currency
                    budget.version += 1
                    budget.updated_by = context.user.id
                    budget.updated_at = utc_now()
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("The AI budget changed.") from exc
        db.add(self._audit(context, workspace_id, request_id, "ai.budget_updated", workspace_id))
        await db.flush()
        return budget

    async def list_routes(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[tuple[AITaskRoute, list[UUID]]]:
        await self.authorize(db, context, workspace_id, request_id)
        routes = list(
            (
                await db.scalars(
                    select(AITaskRoute)
                    .where(
                        AITaskRoute.workspace_id == workspace_id,
                        AITaskRoute.deleted_at.is_(None),
                    )
                    .order_by(AITaskRoute.normalized_name, AITaskRoute.id)
                )
            ).all()
        )
        if not routes:
            return []
        targets = list(
            (
                await db.scalars(
                    select(AITaskRouteTarget)
                    .where(
                        AITaskRouteTarget.workspace_id == workspace_id,
                        AITaskRouteTarget.route_id.in_([route.id for route in routes]),
                    )
                    .order_by(AITaskRouteTarget.route_id, AITaskRouteTarget.position)
                )
            ).all()
        )
        by_route: dict[UUID, list[UUID]] = {route.id: [] for route in routes}
        for target in targets:
            by_route[target.route_id].append(target.model_id)
        return [(route, by_route[route.id]) for route in routes]

    async def create_route(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: AITaskRouteCreate,
        request_id: str,
    ) -> tuple[AITaskRoute, list[UUID]]:
        await self.authorize(db, context, workspace_id, request_id)
        if await db.get(AITaskRoute, payload.id) is not None:
            raise self._conflict("Identifier exists.")
        await self._validate_models(db, workspace_id, payload.model_ids)
        route = AITaskRoute(
            id=payload.id,
            workspace_id=workspace_id,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        self._apply_route(route, payload)
        try:
            async with db.begin_nested():
                db.add(route)
                await db.flush()
                self._add_targets(db, route, payload.model_ids)
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("An active route already uses this name or task type.") from exc
        db.add(self._audit(context, workspace_id, request_id, "ai.route_created", route.id))
        return route, payload.model_ids

    async def update_route(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        route_id: UUID,
        payload: AITaskRouteUpdate,
        request_id: str,
    ) -> tuple[AITaskRoute, list[UUID]]:
        await self.authorize(db, context, workspace_id, request_id)
        route = await self._route(db, workspace_id, route_id, lock=True)
        if route.version != payload.expected_version:
            raise self._conflict("The AI route changed.")
        await self._validate_models(db, workspace_id, payload.model_ids)
        try:
            async with db.begin_nested():
                self._apply_route(route, payload)
                route.version += 1
                route.updated_by = context.user.id
                route.updated_at = utc_now()
                await db.execute(
                    delete(AITaskRouteTarget).where(AITaskRouteTarget.route_id == route.id)
                )
                self._add_targets(db, route, payload.model_ids)
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("An active route already uses this name or task type.") from exc
        db.add(self._audit(context, workspace_id, request_id, "ai.route_updated", route.id))
        return route, payload.model_ids

    async def delete_route(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        route_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> None:
        await self.authorize(db, context, workspace_id, request_id)
        route = await self._route(db, workspace_id, route_id, lock=True)
        if route.version != expected_version:
            raise self._conflict("The AI route changed.")
        route.deleted_at = utc_now()
        route.enabled = False
        route.version += 1
        route.updated_by = context.user.id
        route.updated_at = utc_now()
        db.add(self._audit(context, workspace_id, request_id, "ai.route_deleted", route.id))
        await db.flush()

    async def resolve(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: AIRouteResolveRequest,
        request_id: str,
        *,
        permission: Permission = Permission.AI_CONFIGURE,
    ) -> tuple[AITaskRoute, list[AIRouteCandidate], AIWorkspaceBudget | None]:
        await self.authorize(db, context, workspace_id, request_id, permission)
        route = await db.scalar(
            select(AITaskRoute).where(
                AITaskRoute.workspace_id == workspace_id,
                AITaskRoute.task_type == payload.task_type,
                AITaskRoute.enabled.is_(True),
                AITaskRoute.deleted_at.is_(None),
            )
        )
        if route is None:
            raise APIError(
                code="AI_ROUTE_NOT_FOUND", message="No active AI route exists.", status_code=404
            )
        if (
            payload.estimated_input_tokens > route.max_input_tokens
            or payload.requested_output_tokens > route.max_output_tokens
        ):
            raise APIError(
                code="AI_ROUTE_TOKEN_LIMIT",
                message="The request exceeds the AI route token limit.",
                status_code=422,
            )
        budget = await db.get(AIWorkspaceBudget, workspace_id)
        estimated_tokens = payload.estimated_input_tokens + payload.requested_output_tokens
        if (
            budget
            and budget.monthly_token_budget is not None
            and estimated_tokens > budget.monthly_token_budget
        ):
            raise APIError(
                code="AI_BUDGET_EXCEEDED",
                message="The AI token budget would be exceeded.",
                status_code=409,
            )
        rows = (
            await db.execute(
                select(AITaskRouteTarget, AIModel, AIProvider)
                .join(AIModel, AIModel.id == AITaskRouteTarget.model_id)
                .join(AIProvider, AIProvider.id == AIModel.provider_id)
                .where(
                    AITaskRouteTarget.workspace_id == workspace_id,
                    AITaskRouteTarget.route_id == route.id,
                )
                .order_by(AITaskRouteTarget.position)
            )
        ).all()
        candidates: list[AIRouteCandidate] = []
        for target, model, provider in rows:
            if not self._eligible(route, model, provider, estimated_tokens):
                continue
            currency = budget.currency if budget else model.pricing_currency
            if model.pricing_currency != currency:
                continue
            cost = math.ceil(
                (
                    payload.estimated_input_tokens * model.input_cost_per_million_minor
                    + payload.requested_output_tokens * model.output_cost_per_million_minor
                )
                / 1_000_000
            )
            if (
                budget
                and budget.monthly_cost_budget_minor is not None
                and cost > budget.monthly_cost_budget_minor
            ):
                continue
            candidates.append(
                AIRouteCandidate(
                    model_id=model.id,
                    provider_id=model.provider_id,
                    position=target.position,
                    estimated_tokens=estimated_tokens,
                    estimated_cost_minor=cost,
                    currency=currency,
                    selection="primary" if target.position == 0 else "fallback",
                )
            )
        if not candidates:
            raise APIError(
                code="AI_ROUTE_UNAVAILABLE",
                message="No eligible AI model is currently available.",
                status_code=503,
                retryable=True,
            )
        return route, candidates, budget

    @staticmethod
    def _eligible(route: AITaskRoute, model: AIModel, provider: AIProvider, tokens: int) -> bool:
        return (
            model.enabled
            and model.deleted_at is None
            and provider.enabled
            and provider.deleted_at is None
            and provider.last_health_status == "healthy"
            and (not route.requires_json or model.supports_json)
            and (not route.requires_stream or model.supports_stream)
            and (model.context_window is None or tokens <= model.context_window)
        )

    async def _validate_models(
        self, db: AsyncSession, workspace_id: UUID, model_ids: list[UUID]
    ) -> None:
        found = set(
            (
                await db.scalars(
                    select(AIModel.id).where(
                        AIModel.workspace_id == workspace_id,
                        AIModel.id.in_(model_ids),
                        AIModel.deleted_at.is_(None),
                    )
                )
            ).all()
        )
        if found != set(model_ids):
            raise self._not_found("AI model")

    @staticmethod
    def _apply_route(route: AITaskRoute, payload: AITaskRouteCreate | AITaskRouteUpdate) -> None:
        route.name = payload.name
        route.normalized_name = unicodedata.normalize("NFKC", payload.name).casefold()
        route.task_type = payload.task_type
        route.requires_json = payload.requires_json
        route.requires_stream = payload.requires_stream
        route.max_input_tokens = payload.max_input_tokens
        route.max_output_tokens = payload.max_output_tokens
        route.enabled = payload.enabled

    @staticmethod
    def _add_targets(db: AsyncSession, route: AITaskRoute, model_ids: list[UUID]) -> None:
        db.add_all(
            [
                AITaskRouteTarget(
                    workspace_id=route.workspace_id,
                    route_id=route.id,
                    model_id=model_id,
                    position=position,
                )
                for position, model_id in enumerate(model_ids)
            ]
        )

    @staticmethod
    async def _model(
        db: AsyncSession, workspace_id: UUID, model_id: UUID, *, lock: bool
    ) -> AIModel:
        statement = select(AIModel).where(
            AIModel.id == model_id,
            AIModel.workspace_id == workspace_id,
            AIModel.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update()
        model = await db.scalar(statement)
        if model is None:
            raise AIRoutingService._not_found("AI model")
        return model

    @staticmethod
    async def _route(
        db: AsyncSession, workspace_id: UUID, route_id: UUID, *, lock: bool
    ) -> AITaskRoute:
        statement = select(AITaskRoute).where(
            AITaskRoute.id == route_id,
            AITaskRoute.workspace_id == workspace_id,
            AITaskRoute.deleted_at.is_(None),
        )
        if lock:
            statement = statement.with_for_update()
        route = await db.scalar(statement)
        if route is None:
            raise AIRoutingService._not_found("AI route")
        return route

    @staticmethod
    def _not_found(name: str) -> APIError:
        return APIError(code="RESOURCE_NOT_FOUND", message=f"{name} not found.", status_code=404)

    @staticmethod
    def _conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)

    @staticmethod
    def _audit(
        context: AuthContext,
        workspace_id: UUID,
        request_id: str,
        event_type: str,
        target_id: UUID,
    ) -> AuditEvent:
        return new_audit_event(
            request_id=request_id,
            event_type=event_type,
            result="success",
            actor_id=context.user.id,
            workspace_id=workspace_id,
            target_type="ai_configuration",
            target_id=target_id,
            metadata={},
        )
