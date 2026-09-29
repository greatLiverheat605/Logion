"""Research-gated, reversible Space lifecycle; legacy wire contracts stay fixed."""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.content.models import Note, Resource
from logion_api.db import utc_now
from logion_api.errors import APIError, ErrorResponse
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.identity.service import AuthContext
from logion_api.library.routes import require_enabled, write_boundary
from logion_api.memory.models import KnowledgeSourceLink
from logion_api.sync.models import WorkspaceSyncState
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
    await record_lifecycle(db, context, row, state, request_id(request), f"space.{payload.status}")
    result = response(row, access.membership.role)
    await db.commit()
    return result


async def record_lifecycle(
    db: AsyncSession,
    context: AuthContext,
    row: Space,
    state: WorkspaceSyncState,
    request_identifier: str,
    event_type: str,
) -> None:
    # Existing space payload only. Lifecycle is enforced by current visibility,
    # never by a fabricated tombstone or an unsupported status field in sync-v1.
    ledger = SyncLedgerService()
    value = {"name": row.name, "visibility": row.visibility}
    digest = canonical_hash(value)
    await ledger.append_applied(
        db,
        state,
        SyncOperationIdentity(
            operation_id=uuid7(),
            workspace_id=row.workspace_id,
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
            request_id=request_identifier,
            event_type=event_type,
            result="success",
            actor_id=context.user.id,
            workspace_id=row.workspace_id,
            target_type="space",
            target_id=row.id,
        )
    )


class DeletedSpace(BaseModel):
    id: UUID
    name: str
    visibility: Literal["private", "shared"]
    status: Literal["deleted"]
    version: int
    deleted_at: datetime
    can_manage: bool


class DeletedSpacePage(BaseModel):
    spaces: list[DeletedSpace]
    next_cursor: UUID | None


class SpaceDeletionChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1)
    action: Literal["delete", "restore"]
    confirmation: Literal["DELETE SPACE", "RESTORE SPACE"]


class SpaceDeletionResult(BaseModel):
    id: UUID
    status: Literal["deleted", "archived"]
    version: int
    deleted_at: datetime | None


@router.get("/deleted", response_model=DeletedSpacePage, operation_id="research_space_deleted_list")
async def list_deleted_spaces(
    workspace_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> DeletedSpacePage:
    access = await workspaces.resolve_workspace(
        db, context, workspace_id, request_id=request_id(request)
    )
    query = select(Space).where(
        Space.workspace_id == workspace_id,
        Space.status == "deleted",
        Space.deleted_at.is_not(None),
        or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
    )
    if cursor is not None:
        query = query.where(Space.id > cursor)
    rows = list(await db.scalars(query.order_by(Space.id).limit(limit + 1)))
    return DeletedSpacePage(
        spaces=[
            DeletedSpace.model_validate(
                {
                    "id": row.id,
                    "name": row.name,
                    "visibility": row.visibility,
                    "status": row.status,
                    "version": row.version,
                    "deleted_at": row.deleted_at,
                    "can_manage": row.visibility == "private"
                    or role_has_permission(
                        WorkspaceRole(access.membership.role), Permission.SPACE_DELETE_SHARED
                    ),
                }
            )
            for row in rows[:limit]
        ],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


async def require_no_external_references(db: AsyncSession, row: Space) -> None:
    # Domain writes require same-Space references. Refuse malformed legacy links
    # instead of making a retained reference outside this aggregate unreadable.
    notes = select(Note.id).where(Note.workspace_id == row.workspace_id, Note.space_id == row.id)
    resources = select(Resource.id).where(
        Resource.workspace_id == row.workspace_id, Resource.space_id == row.id
    )
    evidence = select(EvidenceItem.id).where(
        EvidenceItem.workspace_id == row.workspace_id,
        EvidenceItem.space_id != row.id,
        EvidenceItem.deleted_at.is_(None),
        or_(EvidenceItem.note_id.in_(notes), EvidenceItem.resource_id.in_(resources)),
    )
    links = select(KnowledgeSourceLink.id).where(
        KnowledgeSourceLink.workspace_id == row.workspace_id,
        KnowledgeSourceLink.space_id != row.id,
        KnowledgeSourceLink.deleted_at.is_(None),
        KnowledgeSourceLink.source_kind == "note",
        KnowledgeSourceLink.source_id.in_(notes),
    )
    if await db.scalar(evidence.limit(1)) or await db.scalar(links.limit(1)):
        # No count, names or identifiers from a possibly private referencing Space.
        raise APIError(
            code="SPACE_DELETE_BLOCKED_BY_REFERENCE",
            message="Retained references outside this Space prevent deletion.",
            status_code=409,
            retryable=False,
        )


@router.patch(
    "/{space_id}/deletion",
    response_model=SpaceDeletionResult,
    operation_id="research_space_deletion_change",
)
async def change_deletion(
    workspace_id: UUID,
    space_id: UUID,
    payload: SpaceDeletionChange,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> SpaceDeletionResult:
    await write_boundary(request, context, identity, limiter, settings, x_csrf_token)
    identity.require_recent_authentication(context)
    if payload.confirmation != ("DELETE SPACE" if payload.action == "delete" else "RESTORE SPACE"):
        raise APIError(
            code="SPACE_CONFIRMATION_REQUIRED", message="Confirm this action.", status_code=422
        )
    await workspaces.resolve_workspace(db, context, workspace_id, request_id=request_id(request))
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    access = await workspaces.resolve_workspace(
        db, context, workspace_id, request_id=request_id(request)
    )
    query = select(Space).where(
        Space.id == space_id,
        Space.workspace_id == workspace_id,
        or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
    )
    if payload.action == "delete":
        query = query.where(Space.status.in_(("active", "archived")), Space.deleted_at.is_(None))
    else:
        query = query.where(Space.status == "deleted", Space.deleted_at.is_not(None))
    row = await db.scalar(query.execution_options(populate_existing=True).with_for_update())
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
    if payload.action == "delete":
        await require_no_external_references(db, row)
    now = utc_now()
    row.status = "deleted" if payload.action == "delete" else "archived"
    row.deleted_at = now if payload.action == "delete" else None
    row.version += 1
    row.updated_at = now
    row.updated_by = context.user.id
    await record_lifecycle(
        db,
        context,
        row,
        state,
        request_id(request),
        "space.deleted" if payload.action == "delete" else "space.restored",
    )
    result = SpaceDeletionResult.model_validate(
        {
            "id": row.id,
            "status": row.status,
            "version": row.version,
            "deleted_at": row.deleted_at,
        }
    )
    await db.commit()
    return result
