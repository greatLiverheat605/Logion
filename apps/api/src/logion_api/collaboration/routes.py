from typing import Any, cast
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

from logion_api.collaboration.dependencies import CollaborationServiceDependency
from logion_api.collaboration.models import GroupFeedback, ReportSnapshot, ReviewRequest, Rubric
from logion_api.collaboration.schemas import (
    CollaborationFeedbackCreate,
    CollaborationFeedbackResponse,
    CollaborationList,
    CollaborationReportCreate,
    CollaborationReportResponse,
    CollaborationReviewCreate,
    CollaborationReviewResponse,
    CollaborationRubricCreate,
    CollaborationRubricResponse,
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

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/collaboration",
    tags=["collaboration"],
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
        scope="collaboration_write",
        subject_hash=subject,
        limit=settings.collaboration_write_limit_per_hour,
        window=3600,
    )


def response(item: Any, schema: Any) -> Any:
    values = {key: getattr(item, key) for key in schema.model_fields if hasattr(item, key)}
    if schema is CollaborationRubricResponse:
        values.update(workspace_id=item.workspace_id, space_id=item.space_id)
    return schema(**values)


@router.get("", response_model=CollaborationList)
async def list_collaboration(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    collaboration: CollaborationServiceDependency,
) -> CollaborationList:
    rubrics, reviews, feedback, reports = await collaboration.list_all(
        db, context, workspace_id, space_id, request_id(request)
    )
    return CollaborationList(
        rubrics=[response(x, CollaborationRubricResponse) for x in rubrics],
        reviews=[response(x, CollaborationReviewResponse) for x in reviews],
        feedback=[response(x, CollaborationFeedbackResponse) for x in feedback],
        reports=[response(x, CollaborationReportResponse) for x in reports],
    )


async def create_one(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    collaboration: CollaborationServiceDependency,
    workspace_id: UUID,
    space_id: UUID,
    payload: Any,
    model: Any,
    kind: str,
    schema: Any,
    csrf: str | None,
) -> Any:
    await boundary(request, context, identity, limiter, settings, workspace_id, csrf)
    item = await collaboration.create(
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


@router.post(
    "/rubrics", response_model=CollaborationRubricResponse, status_code=status.HTTP_201_CREATED
)
async def create_rubric(
    workspace_id: UUID,
    space_id: UUID,
    payload: CollaborationRubricCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    collaboration: CollaborationServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CollaborationRubricResponse:
    return cast(
        CollaborationRubricResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            collaboration,
            workspace_id,
            space_id,
            payload,
            Rubric,
            "rubric",
            CollaborationRubricResponse,
            x_csrf_token,
        ),
    )


@router.post(
    "/reviews", response_model=CollaborationReviewResponse, status_code=status.HTTP_201_CREATED
)
async def create_review(
    workspace_id: UUID,
    space_id: UUID,
    payload: CollaborationReviewCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    collaboration: CollaborationServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CollaborationReviewResponse:
    return cast(
        CollaborationReviewResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            collaboration,
            workspace_id,
            space_id,
            payload,
            ReviewRequest,
            "review_request",
            CollaborationReviewResponse,
            x_csrf_token,
        ),
    )


@router.post(
    "/feedback", response_model=CollaborationFeedbackResponse, status_code=status.HTTP_201_CREATED
)
async def create_feedback(
    workspace_id: UUID,
    space_id: UUID,
    payload: CollaborationFeedbackCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    collaboration: CollaborationServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CollaborationFeedbackResponse:
    return cast(
        CollaborationFeedbackResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            collaboration,
            workspace_id,
            space_id,
            payload,
            GroupFeedback,
            "group_feedback",
            CollaborationFeedbackResponse,
            x_csrf_token,
        ),
    )


@router.post(
    "/reports", response_model=CollaborationReportResponse, status_code=status.HTTP_201_CREATED
)
async def create_report(
    workspace_id: UUID,
    space_id: UUID,
    payload: CollaborationReportCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    collaboration: CollaborationServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> CollaborationReportResponse:
    return cast(
        CollaborationReportResponse,
        await create_one(
            request,
            context,
            db,
            identity,
            limiter,
            settings,
            collaboration,
            workspace_id,
            space_id,
            payload,
            ReportSnapshot,
            "report_snapshot",
            CollaborationReportResponse,
            x_csrf_token,
        ),
    )
