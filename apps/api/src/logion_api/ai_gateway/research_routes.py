import asyncio
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select

from logion_api.ai_gateway.dependencies import AIRoutingServiceDependency, AIRunServiceDependency
from logion_api.ai_gateway.models import AIOutputDraft, AIRun, AITaskRoute
from logion_api.ai_gateway.research_context import (
    CONTEXT_MODELS,
    RESEARCH_TASK_TIERS,
    ContextEntity,
    build_research_context,
    privacy_audit,
)
from logion_api.ai_gateway.research_skills import load_research_skill
from logion_api.ai_gateway.routing_routes import boundary as routing_boundary
from logion_api.ai_gateway.routing_routes import route_response
from logion_api.ai_gateway.routing_schemas import AITaskRouteCreate, AITaskRouteList
from logion_api.ai_gateway.run_routes import draft_response, run_response, run_write_boundary
from logion_api.ai_gateway.run_schemas import (
    AIOutputDraftResponse,
    AIRunCreate,
    AIRunResponse,
    FieldName,
)
from logion_api.content.models import Note, Resource
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import require_enabled
from logion_api.reading.note_template import missing_sections
from logion_api.workspaces.dependencies import WorkspaceServiceDependency

ResearchTask = Literal[
    "translate",
    "explain",
    "close_reading",
    "quiz_generate",
    "quiz_grade",
    "link_suggest",
    "weekly_comment",
]


class ResearchRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    idempotency_key: UUID
    task_type: ResearchTask
    target: ContextEntity
    context_entities: list[ContextEntity] = Field(default_factory=list, max_length=31)
    expected_output_fields: list[FieldName] = Field(min_length=1, max_length=32)
    # Omit to use the task route's configured output limit (reasoning models need room).
    requested_output_tokens: int | None = Field(default=None, ge=1, le=100000)
    retain_input: bool = False
    send_confirmed: Literal[True]
    question: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def question_task(self) -> "ResearchRunCreate":
        if self.question is not None and (
            self.task_type != "explain" or not self.question.strip() or "\x00" in self.question
        ):
            raise ValueError("A reading question is only valid for an explanation")
        return self

    @field_validator("expected_output_fields")
    @classmethod
    def unique_output_fields(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("expected_output_fields must be unique")
        return value


async def route_output_limit(db: Any, workspace_id: UUID, task_type: str) -> int:
    # Missing routes still fail later with AI_ROUTE_NOT_FOUND; 1 keeps validation intact.
    limit = await db.scalar(
        select(AITaskRoute.max_output_tokens).where(
            AITaskRoute.workspace_id == workspace_id,
            AITaskRoute.task_type == task_type,
            AITaskRoute.enabled.is_(True),
            AITaskRoute.deleted_at.is_(None),
        )
    )
    return int(limit or 1)


class ResearchPreset(BaseModel):
    task_type: ResearchTask
    tier: Literal["economical", "quality"]


class ResearchPresets(BaseModel):
    presets: list[ResearchPreset]


class ResearchPresetApply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    economical_model_ids: list[UUID] = Field(min_length=1, max_length=10)
    quality_model_ids: list[UUID] = Field(min_length=1, max_length=10)
    # Whole-paper close reading and quizzes exceed 16k input tokens; reasoning models
    # spend part of the output budget before answering.
    max_input_tokens: int = Field(default=64000, ge=1, le=10000000)
    max_output_tokens: int = Field(default=8000, ge=1, le=100000)

    @field_validator("economical_model_ids", "quality_model_ids")
    @classmethod
    def unique_model_ids(cls, value: list[UUID]) -> list[UUID]:
        if len(set(value)) != len(value):
            raise ValueError("model_ids must be unique within each tier")
        return value


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}",
    tags=["research-ai"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)},
)


class ResearchRunResult(BaseModel):
    run: AIRunResponse
    draft: AIOutputDraftResponse | None


@router.get(
    "/research/ai/runs/{run_id}",
    response_model=ResearchRunResult,
    operation_id="research_ai_run_result",
)
async def research_run_result(
    workspace_id: UUID,
    run_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    runs: AIRunServiceDependency,
    workspaces: WorkspaceServiceDependency,
) -> ResearchRunResult:
    await runs.authorize(db, context, workspace_id, request_id(request))
    run = await db.scalar(
        select(AIRun).where(
            AIRun.id == run_id,
            AIRun.workspace_id == workspace_id,
            AIRun.requested_by == context.user.id,
            AIRun.task_type.in_(RESEARCH_TASK_TIERS),
        )
    )
    if run is None:
        raise APIError(code="RESOURCE_NOT_FOUND", message="AI run not found.", status_code=404)
    model: Any = CONTEXT_MODELS.get(run.target_type)
    space_id = (
        await db.scalar(
            select(model.space_id).where(
                model.id == run.target_id,
                model.workspace_id == workspace_id,
                model.deleted_at.is_(None),
            )
        )
        if model is not None
        else None
    )
    if space_id is None:
        raise APIError(code="RESOURCE_NOT_FOUND", message="AI source not found.", status_code=404)
    await workspaces.resolve_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    draft = await db.scalar(
        select(AIOutputDraft).where(
            AIOutputDraft.run_id == run.id, AIOutputDraft.workspace_id == workspace_id
        )
    )
    return ResearchRunResult(run=run_response(run), draft=draft_response(draft) if draft else None)


@router.post(
    "/spaces/{space_id}/research/ai/runs",
    response_model=AIRunResponse,
    status_code=202,
    operation_id="research_ai_run_create",
)
async def create_research_run(
    workspace_id: UUID,
    space_id: UUID,
    payload: ResearchRunCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    runs: AIRunServiceDependency,
    workspaces: WorkspaceServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AIRunResponse:
    await run_write_boundary(
        request,
        context,
        identity,
        limiter,
        settings,
        workspace_id,
        x_csrf_token,
        require_recent=False,
    )
    await runs.authorize(db, context, workspace_id, request_id(request))
    await workspaces.resolve_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    entities = [payload.target, *payload.context_entities]
    try:
        fields = await build_research_context(
            db,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            task_type=payload.task_type,
            entities=entities,
        )
        if payload.task_type == "weekly_comment" and payload.expected_output_fields != ["comment"]:
            raise APIError(
                code="AI_DRAFT_SCHEMA_INVALID", message="Expected a comment field.", status_code=422
            )
        if payload.task_type == "link_suggest" and (
            payload.expected_output_fields != ["links"] or len(entities) < 2
        ):
            raise APIError(
                code="AI_DRAFT_SCHEMA_INVALID",
                message="Link suggestions need sources and a links field.",
                status_code=422,
            )
        if payload.task_type in {"quiz_generate", "quiz_grade"}:
            expected = ["questions"] if payload.task_type == "quiz_generate" else ["grade"]
            if payload.expected_output_fields != expected:
                raise APIError(
                    code="AI_DRAFT_SCHEMA_INVALID",
                    message="Unexpected quiz output fields.",
                    status_code=422,
                )
        if payload.task_type == "quiz_generate":
            resource = (
                await db.get(Resource, payload.target.id)
                if payload.target.entity_type == "resource"
                else None
            )
            if resource is None or resource.research_owner_id != context.user.id:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Reading source not found.", status_code=404
                )
        prompt = await asyncio.to_thread(load_research_skill, payload.task_type)
        if payload.task_type == "close_reading" and payload.target.entity_type == "note":
            note = await db.get(Note, payload.target.id)
            if (
                note is not None
                and note.note_kind == "close_reading"
                and not set(payload.expected_output_fields).issubset(
                    missing_sections(note.markdown_body)
                )
            ):
                raise APIError(
                    code="AI_DRAFT_SCHEMA_INVALID",
                    message="Only missing reading sections may be drafted.",
                    status_code=422,
                )
        if payload.question is not None:
            # Explicit owner instruction, never a client-supplied replacement for
            # stored source context. Entity authorization/egress checks still apply.
            fields["reader_question"] = payload.question
        # The run contract is reused; clients cannot submit arbitrary source text to this endpoint.
        run = await runs.create(
            db,
            context,
            workspace_id,
            AIRunCreate(
                id=payload.id,
                idempotency_key=payload.idempotency_key,
                task_type=payload.task_type,
                target_type=payload.target.entity_type,
                target_id=payload.target.id,
                target_version=payload.target.version,
                input_fields=fields,
                expected_output_fields=payload.expected_output_fields,
                requested_output_tokens=payload.requested_output_tokens
                or await route_output_limit(db, workspace_id, payload.task_type),
                retain_input=payload.retain_input,
                send_confirmed=payload.send_confirmed,
            ),
            request_id(request),
            context_entity_types=tuple(ref.entity_type for ref in entities),
            research_prompt=prompt,
        )
        await db.commit()
        return run_response(run)
    except APIError as exc:
        if exc.code == "AI_PRIVATE_CONTENT_BLOCKED":
            db.add(
                privacy_audit(
                    context.user.id,
                    payload.task_type,
                    [ref.entity_type for ref in entities],
                    request_id(request),
                )
            )
        await db.commit()
        raise


@router.get(
    "/research/ai/presets", response_model=ResearchPresets, operation_id="research_ai_presets"
)
async def presets(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    routing: AIRoutingServiceDependency,
) -> ResearchPresets:
    await routing.authorize(db, context, workspace_id, request_id(request))
    return ResearchPresets(
        presets=[
            ResearchPreset.model_validate({"task_type": task, "tier": tier})
            for task, tier in RESEARCH_TASK_TIERS.items()
        ]
    )


@router.post(
    "/research/ai/presets",
    response_model=AITaskRouteList,
    status_code=201,
    operation_id="research_ai_presets_apply",
)
async def apply_presets(
    workspace_id: UUID,
    payload: ResearchPresetApply,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    routing: AIRoutingServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> AITaskRouteList:
    await routing_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    try:
        routes = []
        for task, tier in RESEARCH_TASK_TIERS.items():
            route, models = await routing.create_route(
                db,
                context,
                workspace_id,
                AITaskRouteCreate(
                    id=uuid4(),
                    name=f"research:{task}",
                    task_type=task,
                    requires_json=True,
                    model_ids=payload.economical_model_ids
                    if tier == "economical"
                    else payload.quality_model_ids,
                    max_input_tokens=payload.max_input_tokens,
                    max_output_tokens=payload.max_output_tokens,
                ),
                request_id(request),
            )
            routes.append(route_response(route, models))
        await db.commit()
        return AITaskRouteList(routes=routes)
    except Exception:
        # An existing route or invalid model leaves the entire preset unchanged.
        await db.rollback()
        raise
