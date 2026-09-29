import base64
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy import Select, or_, select
from uuid6 import uuid7

from logion_api.content.dependencies import ContentServiceDependency
from logion_api.content.models import Note, Resource
from logion_api.content.online_schemas import (
    OnlineNoteCreate,
    OnlineNoteDetail,
    OnlineNotePage,
    OnlineNoteRename,
    OnlineNoteSummary,
    OnlineNoteUpdate,
)
from logion_api.content.routes import ERRORS, boundary
from logion_api.content.schemas import NoteWriteRequest
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import require_enabled
from logion_api.library.service import not_found
from logion_api.sync.models import WorkspaceSyncState
from logion_api.sync.push import (
    canonical_hash,
    note_document_state_id,
    note_document_state_payload,
    note_payload,
)
from logion_api.sync.service import AppliedSyncChange, SyncLedgerService, SyncOperationIdentity
from logion_api.workspaces.dependencies import WorkspaceServiceDependency
from logion_api.workspaces.permissions import Permission, WorkspaceRole, role_has_permission

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research/notes",
    tags=["research-records"],
    dependencies=[Depends(require_enabled)],
    responses=ERRORS,
)


async def access(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    workspaces: WorkspaceServiceDependency,
) -> bool:
    space = await workspaces.resolve_space(
        db, context, workspace_id, space_id, request_id=request_id(request)
    )
    membership = await workspaces.resolve_workspace(
        db,
        context,
        workspace_id,
        request_id=request_id(request),
        permission=Permission.WORKSPACE_READ,
    )
    return space.visibility == "private" or role_has_permission(
        WorkspaceRole(membership.membership.role), Permission.SHARED_PLAN_WRITE
    )


NoteAccess = Annotated[bool, Depends(access)]


def scoped(workspace_id: UUID, space_id: UUID, owner_id: UUID) -> Select[tuple[Note]]:
    return select(Note).where(
        Note.workspace_id == workspace_id,
        Note.space_id == space_id,
        Note.deleted_at.is_(None),
        or_(Note.research_owner_id.is_(None), Note.research_owner_id == owner_id),
    )


async def detail(db: DatabaseSession, note: Note, can_write: bool) -> OnlineNoteDetail:
    available = False
    if note.resource_id is not None:
        available = (
            await db.scalar(
                select(Resource.id).where(
                    Resource.id == note.resource_id,
                    Resource.workspace_id == note.workspace_id,
                    Resource.space_id == note.space_id,
                    Resource.research_owner_id == note.research_owner_id,
                    Resource.deleted_at.is_(None),
                )
            )
            is not None
        )
    return OnlineNoteDetail.model_validate(
        {
            "id": note.id,
            "title": note.title,
            "note_kind": note.note_kind,
            "resource_id": note.resource_id,
            "version": note.version,
            "updated_at": note.updated_at,
            "markdown_body": note.markdown_body,
            "yjs_state_base64": base64.b64encode(note.yjs_state).decode("ascii"),
            "yjs_generation": note.yjs_generation,
            "can_edit": can_write and note.research_owner_id is None,
            "source_available": available,
        }
    )


async def prepare_write(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    workspaces: WorkspaceServiceDependency,
    content: ContentServiceDependency,
    x_csrf_token: str | None = Header(default=None),
) -> WorkspaceSyncState:
    await boundary(request, context, identity, limiter, settings, workspace_id, x_csrf_token)
    # Do not take the content Space lock before the sync Workspace lock.
    writable = await access(workspace_id, space_id, request, context, db, workspaces)
    if not writable:
        await workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id(request),
            permission=Permission.SHARED_PLAN_WRITE,
        )
    state = await SyncLedgerService().lock_workspace_state(db, workspace_id)
    # Reauthorize after waiting, before taking the Space/entity locks.
    await content._authorize(db, context, workspace_id, space_id, request_id(request))
    return state


NoteState = Annotated[WorkspaceSyncState, Depends(prepare_write)]


async def save(
    db: DatabaseSession,
    context: AuthContextDependency,
    state: WorkspaceSyncState,
    note: Note,
    operation: Literal["create", "update"],
    update_base64: str | None = None,
) -> OnlineNoteDetail:
    assert note.research_owner_id is None
    await db.flush()
    projections = [
        ("note", note.id, note_payload(note)),
        ("note_document_state", note_document_state_id(note), note_document_state_payload(note)),
    ]
    if update_base64 is not None:
        projections.insert(
            0,
            (
                "note_document_update",
                note.id,
                {
                    "space_id": str(note.space_id),
                    "note_id": str(note.id),
                    "note_version": note.version,
                    "yjs_generation": note.yjs_generation,
                    "update_base64": update_base64,
                },
            ),
        )
    ledger = SyncLedgerService()
    for entity_type, entity_id, payload in projections:
        digest = canonical_hash(payload)
        await ledger.append_applied(
            db,
            state,
            SyncOperationIdentity(
                operation_id=uuid7(),
                workspace_id=note.workspace_id,
                device_id=context.device.id,
                payload_hash=digest,
                operation_fingerprint=digest,
                entity_type=entity_type,
                entity_id=entity_id,
                operation_type=operation,
            ),
            AppliedSyncChange(server_version=note.version, payload=payload, payload_hash=digest),
        )
    result = await detail(db, note, True)
    await db.commit()
    return result


@router.get("", response_model=OnlineNotePage, operation_id="online_note_list")
async def list_notes(
    workspace_id: UUID,
    space_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    writable: NoteAccess,
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> OnlineNotePage:
    # Only load summaries; a page of large Yjs documents must not be materialized.
    query = scoped(workspace_id, space_id, context.user.id).with_only_columns(
        Note.id,
        Note.title,
        Note.note_kind,
        Note.resource_id,
        Note.version,
        Note.updated_at,
    )
    if cursor is not None:
        query = query.where(Note.id < cursor)
    rows = (await db.execute(query.order_by(Note.id.desc()).limit(limit + 1))).mappings().all()
    return OnlineNotePage(
        notes=[OnlineNoteSummary.model_validate(row) for row in rows[:limit]],
        next_cursor=rows[limit - 1]["id"] if len(rows) > limit else None,
        can_create=writable,
    )


@router.get("/{note_id}", response_model=OnlineNoteDetail, operation_id="online_note_get")
async def get_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    context: AuthContextDependency,
    db: DatabaseSession,
    writable: NoteAccess,
) -> OnlineNoteDetail:
    note = await db.scalar(
        scoped(workspace_id, space_id, context.user.id).where(Note.id == note_id)
    )
    if note is None:
        raise not_found()
    return await detail(db, note, writable)


@router.post(
    "", response_model=OnlineNoteDetail, status_code=201, operation_id="online_note_create"
)
async def create_note(
    workspace_id: UUID,
    space_id: UUID,
    payload: OnlineNoteCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    content: ContentServiceDependency,
    state: NoteState,
) -> OnlineNoteDetail:
    note = await content.create_note(
        db,
        context,
        workspace_id,
        space_id,
        NoteWriteRequest(id=payload.id, title=payload.title),
        request_id(request),
    )
    return await save(db, context, state, note, "create")


@router.patch("/{note_id}", response_model=OnlineNoteDetail, operation_id="online_note_rename")
async def rename_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    payload: OnlineNoteRename,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    state: NoteState,
) -> OnlineNoteDetail:
    note = await db.scalar(
        scoped(workspace_id, space_id, context.user.id)
        .where(
            Note.id == note_id,
            Note.research_owner_id.is_(None),
        )
        .with_for_update()
    )
    if note is None:
        raise not_found()
    if note.version != payload.expected_version:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT", message="The note changed.", status_code=409
        )
    note.title, note.updated_by, note.updated_at = payload.title, context.user.id, utc_now()
    note.version += 1
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type="content.note_renamed",
            result="success",
            actor_id=context.user.id,
            workspace_id=workspace_id,
            target_type="note",
            target_id=note.id,
            metadata={"version": note.version},
        )
    )
    return await save(db, context, state, note, "update")


@router.patch(
    "/{note_id}/document", response_model=OnlineNoteDetail, operation_id="online_note_update"
)
async def update_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    payload: OnlineNoteUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    content: ContentServiceDependency,
    state: NoteState,
) -> OnlineNoteDetail:
    if payload.space_id != space_id:
        raise not_found()
    try:
        update = payload.decoded_update()
    except ValueError as exc:
        raise APIError(
            code="NOTE_DOCUMENT_UPDATE_INVALID", message="Invalid document update.", status_code=422
        ) from exc
    note = await content.apply_note_document_update(
        db,
        context,
        workspace_id,
        space_id,
        note_id,
        payload.base_version,
        payload.yjs_generation,
        update,
        request_id(request),
    )
    return await save(db, context, state, note, "update", payload.update_base64)
