from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

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
from logion_api.research.dependencies import ResearchServiceDependency
from logion_api.research.models import (
    ExperimentRun,
    MetricRecord,
    PaperRecord,
    ResearchClaim,
    ResearchFeedback,
    ResearchQuestion,
)
from logion_api.research.schemas import (
    ClaimCreate,
    ClaimResponse,
    FeedbackCreate,
    FeedbackResponse,
    MetricCreate,
    MetricResponse,
    PaperCreate,
    PaperResponse,
    QuestionCreate,
    QuestionResponse,
    ResearchList,
    RunCreate,
    RunResponse,
)

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research", tags=["research"]
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
    require_trusted_origin(request, settings)
    identity.validate_csrf(context.session, csrf, request.cookies.get(settings.csrf_cookie_name))
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="research_write",
        subject_hash=subject,
        limit=settings.research_write_limit_per_hour,
        window=3600,
    )


def response(item: Any, schema: Any) -> Any:
    values = {key: getattr(item, key) for key in schema.model_fields if hasattr(item, key)}
    if schema is PaperResponse:
        values.update(workspace_id=item.workspace_id, space_id=item.space_id)
    return schema(**values)


@router.get("", response_model=ResearchList, operation_id="research_list")
async def list_research(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    research: ResearchServiceDependency,
) -> ResearchList:
    papers, claims, questions, runs, metrics, feedback = await research.list_all(
        db, context, workspace_id, space_id, request_id(request)
    )
    return ResearchList(
        papers=[response(x, PaperResponse) for x in papers],
        claims=[response(x, ClaimResponse) for x in claims],
        questions=[response(x, QuestionResponse) for x in questions],
        runs=[response(x, RunResponse) for x in runs],
        metrics=[response(x, MetricResponse) for x in metrics],
        feedback=[response(x, FeedbackResponse) for x in feedback],
    )


async def create_one(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    workspace_id: UUID,
    space_id: UUID,
    payload: Any,
    model: Any,
    kind: str,
    schema: Any,
    csrf: str | None,
) -> Any:
    await boundary(request, context, identity, limiter, settings, workspace_id, csrf)
    item = await research.create(
        db,
        context,
        workspace_id,
        space_id,
        model,
        payload.model_dump(mode="python"),
        request_id(request),
        kind,
    )
    await db.commit()
    return response(item, schema)


@router.post("/papers", response_model=PaperResponse, status_code=status.HTTP_201_CREATED)
async def create_paper(
    workspace_id: UUID,
    space_id: UUID,
    payload: PaperCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> PaperResponse:
    return cast(
        PaperResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            PaperRecord,
            "paper_record",
            PaperResponse,
            x_csrf_token,
        ),
    )


@router.post("/claims", response_model=ClaimResponse, status_code=status.HTTP_201_CREATED)
async def create_claim(
    workspace_id: UUID,
    space_id: UUID,
    payload: ClaimCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ClaimResponse:
    return cast(
        ClaimResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            ResearchClaim,
            "research_claim",
            ClaimResponse,
            x_csrf_token,
        ),
    )


@router.post("/questions", response_model=QuestionResponse, status_code=status.HTTP_201_CREATED)
async def create_question(
    workspace_id: UUID,
    space_id: UUID,
    payload: QuestionCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> QuestionResponse:
    return cast(
        QuestionResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            ResearchQuestion,
            "research_question",
            QuestionResponse,
            x_csrf_token,
        ),
    )


@router.post("/runs", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    workspace_id: UUID,
    space_id: UUID,
    payload: RunCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> RunResponse:
    return cast(
        RunResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            ExperimentRun,
            "experiment_run",
            RunResponse,
            x_csrf_token,
        ),
    )


@router.post("/metrics", response_model=MetricResponse, status_code=status.HTTP_201_CREATED)
async def create_metric(
    workspace_id: UUID,
    space_id: UUID,
    payload: MetricCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> MetricResponse:
    return cast(
        MetricResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            MetricRecord,
            "metric_record",
            MetricResponse,
            x_csrf_token,
        ),
    )


@router.post("/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    workspace_id: UUID,
    space_id: UUID,
    payload: FeedbackCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    research: ResearchServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> FeedbackResponse:
    return cast(
        FeedbackResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            research,
            workspace_id,
            space_id,
            payload,
            ResearchFeedback,
            "research_feedback",
            FeedbackResponse,
            x_csrf_token,
        ),
    )
