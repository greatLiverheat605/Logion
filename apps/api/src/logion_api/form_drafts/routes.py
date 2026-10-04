from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from logion_api.db import utc_now
from logion_api.errors import ErrorResponse
from logion_api.form_drafts import service
from logion_api.form_drafts.schemas import DraftKind, DraftResponse, DraftView, DraftWrite
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.library.routes import Service, require_enabled, write_boundary

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/form-drafts",
    tags=["form-drafts"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


@router.get("/{kind}/{target}", response_model=DraftResponse, operation_id="form_draft_get")
async def get_draft(
    workspace_id: UUID,
    space_id: UUID,
    kind: DraftKind,
    target: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    library: Service,
) -> DraftResponse:
    await service.authorize_target(
        db, library, context, workspace_id, space_id, kind, target, request_id(request)
    )
    row = await db.scalar(service.scoped(context.user.id, workspace_id, space_id, kind, target))
    return DraftResponse(
        draft=DraftView.model_validate(row) if row and row.expires_at > utc_now() else None
    )


@router.put(
    "/{kind}/{target}",
    response_model=DraftResponse,
    operation_id="form_draft_put",
    dependencies=[Depends(write_boundary)],
)
async def put_draft(
    workspace_id: UUID,
    space_id: UUID,
    kind: DraftKind,
    target: UUID,
    payload: DraftWrite,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    library: Service,
) -> DraftResponse:
    await service.lock_user(db, context)
    await service.authorize_target(
        db, library, context, workspace_id, space_id, kind, target, request_id(request), write=True
    )
    row = await service.save(
        db, context, workspace_id, space_id, kind, target, payload, request_id(request)
    )
    result = DraftResponse(draft=DraftView.model_validate(row))
    await db.commit()
    return result


@router.delete(
    "/{kind}/{target}",
    status_code=204,
    operation_id="form_draft_delete",
    dependencies=[Depends(write_boundary)],
)
async def delete_draft(
    workspace_id: UUID,
    space_id: UUID,
    kind: DraftKind,
    target: UUID,
    expected_version: Annotated[int, Query(ge=1)],
    expected_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    library: Service,
) -> Response:
    await service.lock_user(db, context)
    await service.authorize_target(
        db, library, context, workspace_id, space_id, kind, target, request_id(request), write=True
    )
    row = await db.scalar(
        service.scoped(context.user.id, workspace_id, space_id, kind, target).with_for_update()
    )
    if row:
        if row.version != expected_version or row.id != expected_id:
            raise service.conflict()
        service.audit(db, context.user.id, request_id(request), kind, "discarded")
        await db.delete(row)
    await db.commit()
    return Response(status_code=204, headers={"Cache-Control": "private, no-store"})
