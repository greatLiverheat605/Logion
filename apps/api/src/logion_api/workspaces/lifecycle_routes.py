"""Research-gated, reversible Space lifecycle; legacy wire contracts stay fixed."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from uuid6 import uuid7

from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import require_enabled, write_boundary
from logion_api.sync.push import canonical_hash
from logion_api.sync.service import AppliedSyncChange, SyncLedgerService, SyncOperationIdentity
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission, WorkspaceRole, role_has_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/research/spaces",
    tags=["research-spaces"],
    dependencies=[Depends(require_enabled)],
    responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429)},
)


class ManagedSpace(BaseModel):
    id: UUID
    name: str
    visibility: Literal["private", "shared"]
    status: Literal["active", "archived"]
    version: int
    updated_at: datetime
    can_manage: bool


class ManagedSpacePage(BaseModel):
    spaces: list[ManagedSpace]
    next_cursor: UUID | None


class SpaceArchiveChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    status: Literal["active", "archived"]


def response(row: Space, role: str) -> ManagedSpace:
    return ManagedSpace.model_validate(
        {
            "id": row.id,
            "name": row.name,
            "visibility": row.visibility,
            "status": row.status,
            "version": row.version,
            "updated_at": row.updated_at,
            "can_manage": row.visibility == "private"
            or role_has_permission(WorkspaceRole(role), Permission.SPACE_DELETE_SHARED),
        }
    )


@router.get("", response_model=ManagedSpacePage, operation_id="research_space_management_list")
async def list_spaces(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    status: Literal["active", "archived"] | None = None,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ManagedSpacePage:
    access = await workspaces.resolve_workspace(
        db, context, workspace_id, request_id=request_id(request)
    )
    query = select(Space).where(
        Space.workspace_id == workspace_id,
        Space.status.in_(("active", "archived")),
        Space.deleted_at.is_(None),
        or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
    )
    if status is not None:
        query = query.where(Space.status == status)
    if cursor is not None:
        query = query.where(Space.id > cursor)
    rows = list(await db.scalars(query.order_by(Space.id).limit(limit + 1)))
    return ManagedSpacePage(
        spaces=[response(row, access.membership.role) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.patch(
    "/{space_id}/archive", response_model=ManagedSpace, operation_id="research_space_archive_change"
)
async def change_archive(
    workspace_id: UUID,
    space_id: UUID,
    payload: SpaceArchiveChange,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ManagedSpace:
    await write_boundary(request, context, identity, limiter, settings, x_csrf_token)
    identity.require_recent_authentication(context)
    await workspaces.resolve_workspace(db, context, workspace_id, request_id=request_id(request))
    ledger = SyncLedgerService()
    # Membership changes and legacy/online sync writes use this same lock order.
    state = await ledger.lock_workspace_state(db, workspace_id)
    access = await workspaces.resolve_workspace(
        db, context, workspace_id, request_id=request_id(request)
    )
    row = await db.scalar(
        select(Space)
        .where(
            Space.id == space_id,
            Space.workspace_id == workspace_id,
            Space.status.in_(("active", "archived")),
            Space.deleted_at.is_(None),
            or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if row is None:
        raise workspaces._not_found_error()
    if row.visibility == "shared":
        workspaces.require_permission(
            db,
            access,
            context.user.id,
            Permission.SPACE_DELETE_SHARED,
            request_id=request_id(request),
        )
    if row.version != payload.expected_version:
        raise APIError(
            code="SPACE_VERSION_CONFLICT",
            message="Refresh the Space before retrying.",
            status_code=409,
        )
    if row.status == payload.status:
        raise APIError(
            code="SPACE_NO_CHANGE", message="Space already has this status.", status_code=409
        )
    row.status = payload.status
    row.version += 1
    row.updated_at = utc_now()
    row.updated_by = context.user.id
    # Existing space payload only. Lifecycle is enforced by current visibility,
    # never by a fabricated tombstone or an unsupported status field in sync-v1.
    value = {"name": row.name, "visibility": row.visibility}
    digest = canonical_hash(value)
    await ledger.append_applied(
        db,
        state,
        SyncOperationIdentity(
            operation_id=uuid7(),
            workspace_id=workspace_id,
            device_id=context.device.id,
            payload_hash=digest,
            operation_fingerprint=digest,
            entity_type="space",
            entity_id=row.id,
            operation_type="update",
        ),
        AppliedSyncChange(server_version=row.version, payload=value, payload_hash=digest),
    )
    # Same-epoch bootstrap preserves pending/conflicted local work. Keeping the
    # floor at this barrier also makes restored content reach existing cursors.
    state.min_retained_sequence = state.last_sequence
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"space.{payload.status}",
            result="success",
            actor_id=context.user.id,
            workspace_id=workspace_id,
            target_type="space",
            target_id=row.id,
        )
    )
    result = response(row, access.membership.role)
    await db.commit()
    return result
