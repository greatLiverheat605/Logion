from typing import Any
from uuid import UUID

from fastapi import APIRouter, Header, Request, status

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
from logion_api.self_study.dependencies import SelfStudyServiceDependency
from logion_api.self_study.models import Deliverable, InboxItem, LearningTrack, StudyProject
from logion_api.self_study.schemas import (
    DeliverableCreateRequest,
    DeliverableResponse,
    InboxItemCreateRequest,
    InboxItemResponse,
    ProjectCreateRequest,
    ProjectResponse,
    SelfStudyListResponse,
    TrackCreateRequest,
    TrackResponse,
)

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/self-study", tags=["self-study"]
)
ERRORS: dict[int | str, dict[str, Any]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


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
    subject = get_security().privacy_hash(f"{workspace_id}:{context.user.id}") or "unknown"
    await limiter.enforce(
        scope="self_study_write",
        subject_hash=subject,
        limit=settings.self_study_write_limit_per_hour,
        window=3600,
    )


def track_response(item: LearningTrack) -> TrackResponse:
    return TrackResponse(
        id=item.id,
        workspace_id=item.workspace_id,
        space_id=item.space_id,
        title=item.title,
        objective=item.objective,
        version=item.version,
    )


def project_response(item: StudyProject) -> ProjectResponse:
    return ProjectResponse(
        id=item.id,
        track_id=item.track_id,
        title=item.title,
        intended_outcome=item.intended_outcome,
        version=item.version,
    )


def inbox_response(item: InboxItem) -> InboxItemResponse:
    return InboxItemResponse(id=item.id, title=item.title, note=item.note, version=item.version)


def deliverable_response(item: Deliverable) -> DeliverableResponse:
    return DeliverableResponse(
        id=item.id,
        project_id=item.project_id,
        title=item.title,
        evidence_summary=item.evidence_summary,
        completed_at=item.completed_at,
        version=item.version,
    )


@router.get(
    "", response_model=SelfStudyListResponse, operation_id="self_study_list", responses=ERRORS
)
async def list_self_study(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    self_study: SelfStudyServiceDependency,
) -> SelfStudyListResponse:
    tracks, projects, inbox, deliverables = await self_study.list_all(
        db, context, workspace_id, space_id, request_id(request)
    )
    return SelfStudyListResponse(
        tracks=[track_response(x) for x in tracks],
        projects=[project_response(x) for x in projects],
        inbox_items=[inbox_response(x) for x in inbox],
        deliverables=[deliverable_response(x) for x in deliverables],
    )


async def _commit_created(
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspace_id: UUID,
    csrf: str | None,
) -> None:
    await write_boundary(request, context, identity, limiter, settings, workspace_id, csrf)


@router.post(
    "/tracks",
    response_model=TrackResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="learning_track_create",
    responses=ERRORS,
)
async def create_track(
    workspace_id: UUID,
    space_id: UUID,
    payload: TrackCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    self_study: SelfStudyServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> TrackResponse:
    await _commit_created(
        request, context, db, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await self_study.create_track(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return track_response(item)


@router.post(
    "/projects",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="study_project_create",
    responses=ERRORS,
)
async def create_project(
    workspace_id: UUID,
    space_id: UUID,
    payload: ProjectCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    self_study: SelfStudyServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ProjectResponse:
    await _commit_created(
        request, context, db, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await self_study.create_project(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return project_response(item)


@router.post(
    "/inbox",
    response_model=InboxItemResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="inbox_item_create",
    responses=ERRORS,
)
async def create_inbox_item(
    workspace_id: UUID,
    space_id: UUID,
    payload: InboxItemCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    self_study: SelfStudyServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> InboxItemResponse:
    await _commit_created(
        request, context, db, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await self_study.create_inbox_item(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return inbox_response(item)


@router.post(
    "/deliverables",
    response_model=DeliverableResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="deliverable_create",
    responses=ERRORS,
)
async def create_deliverable(
    workspace_id: UUID,
    space_id: UUID,
    payload: DeliverableCreateRequest,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    self_study: SelfStudyServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> DeliverableResponse:
    await _commit_created(
        request, context, db, identity, limiter, settings, workspace_id, x_csrf_token
    )
    item = await self_study.create_deliverable(
        db, context, workspace_id, space_id, payload, request_id(request)
    )
    await db.commit()
    return deliverable_response(item)
