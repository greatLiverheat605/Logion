import base64
import hashlib
import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import TypeAdapter
from sqlalchemy import Select, func, select, text

from logion_api.agents.models import AgentInboxItem, AgentToken
from logion_api.agents.schemas import (
    AgentDecision,
    AgentEdge,
    AgentInboxPage,
    AgentInboxView,
    AgentNote,
    AgentPayload,
    AgentSource,
    AgentStatus,
    AgentSubmission,
    AgentSubmissionReceipt,
)
from logion_api.agents.security import (
    AgentDatabase,
    Token,
    lock_scope,
    require_enabled,
    require_inbox,
)
from logion_api.content.models import Note
from logion_api.content.online_schemas import OnlineNoteDetail, OnlineNoteRename, OnlineNoteUpdate
from logion_api.content.yjs_documents import (
    YjsDocumentError,
    apply_document_update,
    state_from_markdown,
)
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    SettingsDependency,
    request_id,
)
from logion_api.identity.models import User
from logion_api.knowledge.service import (
    NODE_MODELS,
    edge_quota,
    identity_filter,
    new_edge,
    nodes,
    owned_edges,
    validate_endpoints,
)
from logion_api.library.routes import Service, write_boundary
from logion_api.library.service import not_found

submit_router = APIRouter(
    prefix="/api/v1/agent", tags=["agent"], dependencies=[Depends(require_inbox)]
)
router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/agent-inbox",
    tags=["agent-inbox"],
    dependencies=[Depends(require_enabled)],
)
adapter: TypeAdapter[AgentPayload] = TypeAdapter(AgentPayload)


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def conflict(code: str = "AGENT_INBOX_CONFLICT") -> APIError:
    return APIError(
        code=code, message="This inbox item changed or was already decided.", status_code=409
    )


async def serialize_submissions(db: AgentDatabase, user: UUID, space: UUID) -> None:
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:identity, 0))"),
        {"identity": f"agent-inbox:{user}:{space}"},
    )


@submit_router.post(
    "/inbox",
    response_model=AgentSubmissionReceipt,
    status_code=201,
    operation_id="agent_submit_inbox",
)
async def submit(
    payload: AgentSubmission, token: Token, db: AgentDatabase, settings: SettingsDependency
) -> AgentSubmissionReceipt:
    await serialize_submissions(db, token.user_id, token.space_id)
    body = payload.payload.model_dump(mode="json", by_alias=True)
    fingerprint = digest(body)
    existing = await db.scalar(
        select(AgentInboxItem).where(
            AgentInboxItem.token_id == token.id,
            AgentInboxItem.submission_key == payload.submission_key,
        )
    )
    if existing is not None:
        if existing.payload_digest != fingerprint:
            raise conflict("AGENT_SUBMISSION_KEY_REUSED")
        return AgentSubmissionReceipt.model_validate(existing)
    if isinstance(payload.payload, AgentEdge):
        await validate_endpoints(
            db, token.workspace_id, token.space_id, token.user_id, payload.payload.edge()
        )
    count = await db.scalar(
        select(func.count())
        .select_from(AgentInboxItem)
        .where(AgentInboxItem.user_id == token.user_id, AgentInboxItem.space_id == token.space_id)
    )
    if (count or 0) >= settings.research_entity_per_user_quota:
        raise APIError(
            code="AGENT_INBOX_QUOTA", message="Inbox storage limit reached.", status_code=409
        )
    item = AgentInboxItem(
        token_id=token.id,
        user_id=token.user_id,
        workspace_id=token.workspace_id,
        space_id=token.space_id,
        submission_key=payload.submission_key,
        kind=payload.payload.kind,
        payload=body,
        payload_digest=fingerprint,
    )
    db.add(item)
    await db.flush()
    return AgentSubmissionReceipt.model_validate(item)


def scoped(workspace: UUID, space: UUID, user: UUID) -> Select[tuple[AgentInboxItem]]:
    return select(AgentInboxItem).where(
        AgentInboxItem.workspace_id == workspace,
        AgentInboxItem.space_id == space,
        AgentInboxItem.user_id == user,
    )


def audit(db: DatabaseSession, request: Request, user: UUID, action: str) -> None:
    db.add(
        new_audit_event(
            request_id=request_id(request),
            event_type=f"agent.inbox_{action}",
            result="success",
            actor_id=user,
            target_type="agent_inbox",
            metadata={},
        )
    )


@router.get("", response_model=AgentInboxPage, operation_id="agent_inbox_list")
async def list_inbox(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    status: AgentStatus = "pending",
    cursor: UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> AgentInboxPage:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    query = scoped(workspace_id, space_id, context.user.id).where(AgentInboxItem.status == status)
    if cursor:
        query = query.where(AgentInboxItem.id < cursor)
    rows = list(await db.scalars(query.order_by(AgentInboxItem.id.desc()).limit(limit + 1)))
    return AgentInboxPage(
        items=[await inbox_view(db, row) for row in rows[:limit]],
        next_cursor=rows[limit - 1].id if len(rows) > limit else None,
    )


@router.post(
    "/{item_id}/decision",
    response_model=AgentInboxView,
    operation_id="agent_inbox_decide",
    dependencies=[Depends(write_boundary)],
)
async def decide(
    workspace_id: UUID,
    space_id: UUID,
    item_id: UUID,
    payload: AgentDecision,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    settings: SettingsDependency,
) -> AgentInboxView:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    await lock_scope(db, context.user.id, workspace_id, space_id)
    item = await db.scalar(
        scoped(workspace_id, space_id, context.user.id)
        .where(AgentInboxItem.id == item_id)
        .with_for_update()
    )
    if item is None:
        raise not_found()
    accepted = payload.payload or adapter.validate_python(item.payload)
    if accepted.kind != item.kind:
        raise APIError(
            code="AGENT_INBOX_KIND_IMMUTABLE",
            message="Keep the proposal type when editing.",
            status_code=422,
        )
    body = accepted.model_dump(mode="json", by_alias=True)
    fingerprint = digest(
        {"decision": payload.decision, "payload": body if payload.decision == "accepted" else None}
    )
    if item.status != "pending":
        if item.decision_digest == fingerprint:
            return await inbox_view(db, item)
        raise conflict()
    if item.version != payload.expected_version:
        raise conflict("RESOURCE_VERSION_CONFLICT")
    if payload.decision == "accepted":
        if isinstance(accepted, AgentSource):
            resource = await service.create(
                db, context, workspace_id, space_id, accepted.library(), request_id(request)
            )
            receipt = {"entity_type": "resource", "id": str(resource.id)}
        elif isinstance(accepted, AgentNote):
            count = await db.scalar(
                select(func.count())
                .select_from(Note)
                .where(
                    Note.research_owner_id == context.user.id,
                    Note.space_id == space_id,
                    Note.deleted_at.is_(None),
                )
            )
            if (count or 0) >= settings.research_entity_per_user_quota:
                raise APIError(
                    code="RESOURCE_QUOTA_EXCEEDED", message="Note limit reached.", status_code=409
                )
            try:
                state = state_from_markdown(accepted.markdown_body)
            except YjsDocumentError as exc:
                raise APIError(
                    code="NOTE_DOCUMENT_TOO_LARGE",
                    message="The note is too large.",
                    status_code=422,
                ) from exc
            note = Note(
                workspace_id=workspace_id,
                space_id=space_id,
                research_owner_id=context.user.id,
                agent_inbox_item_id=item.id,
                title=accepted.title,
                markdown_body=accepted.markdown_body,
                yjs_state=state,
                created_by=context.user.id,
                updated_by=context.user.id,
            )
            db.add(note)
            await db.flush()
            receipt = {"entity_type": "note", "id": str(note.id)}
        else:
            edge_fields = accepted.edge()
            await validate_endpoints(db, workspace_id, space_id, context.user.id, edge_fields)
            existing = await db.scalar(
                owned_edges(workspace_id, space_id, context.user.id).where(
                    identity_filter(edge_fields)
                )
            )
            if existing is not None:
                raise conflict(
                    "KNOWLEDGE_EDGE_TERMINAL"
                    if existing.status == "rejected"
                    else "KNOWLEDGE_EDGE_EXISTS"
                )
            await edge_quota(
                db, workspace_id, context.user.id, 1, settings.research_entity_per_user_quota
            )
            edge = new_edge(workspace_id, space_id, context.user.id, edge_fields)
            db.add(edge)
            await db.flush()
            receipt = {"entity_type": "knowledge_edge", "id": str(edge.id)}
        item.accepted_payload, item.receipt = body, receipt
    item.status, item.decided_at, item.decision_digest = payload.decision, utc_now(), fingerprint
    item.version += 1
    audit(db, request, context.user.id, payload.decision)
    await db.flush()
    result = await inbox_view(db, item)
    await db.commit()
    return result


def note_response(note: Note) -> OnlineNoteDetail:
    return OnlineNoteDetail(
        id=note.id,
        title=note.title,
        note_kind=None,
        resource_id=None,
        version=note.version,
        updated_at=note.updated_at,
        markdown_body=note.markdown_body,
        yjs_state_base64=base64.b64encode(note.yjs_state).decode("ascii"),
        yjs_generation=note.yjs_generation,
        can_edit=True,
        source_available=False,
    )


async def load_note(
    db: DatabaseSession,
    workspace: UUID,
    space: UUID,
    user: UUID,
    identity: UUID,
    *,
    write: bool = False,
) -> Note:
    query = select(Note).where(
        Note.id == identity,
        Note.workspace_id == workspace,
        Note.space_id == space,
        Note.research_owner_id == user,
        Note.agent_inbox_item_id.is_not(None),
        Note.deleted_at.is_(None),
    )
    note = await db.scalar(query.with_for_update() if write else query)
    if note is None:
        raise not_found()
    return note


@router.get("/notes/{note_id}", response_model=OnlineNoteDetail, operation_id="agent_note_get")
async def get_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> OnlineNoteDetail:
    await service.authorize(db, context, workspace_id, space_id, request_id(request))
    return note_response(await load_note(db, workspace_id, space_id, context.user.id, note_id))


@router.patch(
    "/notes/{note_id}/document",
    response_model=OnlineNoteDetail,
    operation_id="agent_note_update",
    dependencies=[Depends(write_boundary)],
)
async def update_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    payload: OnlineNoteUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> OnlineNoteDetail:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    await lock_scope(db, context.user.id, workspace_id, space_id)
    note = await load_note(db, workspace_id, space_id, context.user.id, note_id, write=True)
    if payload.space_id != space_id:
        raise not_found()
    if payload.base_version > note.version or payload.yjs_generation != note.yjs_generation:
        raise conflict("RESOURCE_VERSION_CONFLICT")
    try:
        snapshot = apply_document_update(note.yjs_state, payload.decoded_update())
    except (ValueError, YjsDocumentError) as exc:
        raise APIError(
            code="NOTE_DOCUMENT_UPDATE_INVALID",
            message="The note update is invalid or too large.",
            status_code=422,
        ) from exc
    if note.yjs_state != snapshot.state:
        note.markdown_body, note.yjs_state = snapshot.markdown, snapshot.state
        note.updated_at, note.updated_by = utc_now(), context.user.id
        note.version += 1
        audit(db, request, context.user.id, "note_saved")
    result = note_response(note)
    await db.commit()
    return result


async def inbox_view(db: DatabaseSession, item: AgentInboxItem) -> AgentInboxView:
    result = AgentInboxView.model_validate(item)
    result.agent_name = (
        await db.scalar(
            select(AgentToken.name).where(
                AgentToken.id == item.token_id, AgentToken.user_id == item.user_id
            )
        )
        or "已撤销的 Agent"
    )
    payload = adapter.validate_python(item.accepted_payload or item.payload)
    if isinstance(payload, AgentEdge):
        for kind, identity in (
            (payload.from_type, payload.from_id),
            (payload.to_type, payload.to_id),
        ):
            row = await db.scalar(
                nodes(kind, item.workspace_id, item.space_id, item.user_id).where(
                    NODE_MODELS[kind].id == identity
                )
            )
            label = (
                getattr(row, "title", None)
                or getattr(row, "question", None)
                or getattr(row, "statement", None)
            )
            result.references.append(str(label)[:300] if label else "来源已删除或不可访问")
    return result


@router.patch(
    "/notes/{note_id}",
    response_model=OnlineNoteDetail,
    operation_id="agent_note_rename",
    dependencies=[Depends(write_boundary)],
)
async def rename_note(
    workspace_id: UUID,
    space_id: UUID,
    note_id: UUID,
    payload: OnlineNoteRename,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
) -> OnlineNoteDetail:
    await db.scalar(select(User.id).where(User.id == context.user.id).with_for_update())
    await lock_scope(db, context.user.id, workspace_id, space_id)
    note = await load_note(db, workspace_id, space_id, context.user.id, note_id, write=True)
    if payload.expected_version != note.version:
        raise conflict("RESOURCE_VERSION_CONFLICT")
    note.title, note.updated_by, note.updated_at = payload.title, context.user.id, utc_now()
    note.version += 1
    audit(db, request, context.user.id, "note_renamed")
    result = note_response(note)
    await db.commit()
    return result
