import base64
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.dependencies import AIRunServiceDependency
from logion_api.ai_gateway.models import AIOutputDraft, AIRun
from logion_api.ai_gateway.research_routes import ResearchRunResult
from logion_api.ai_gateway.run_routes import draft_response, run_response, run_write_boundary
from logion_api.content.models import Note, Resource
from logion_api.content.schemas import NoteDocumentUpdate
from logion_api.content.yjs_documents import (
    YjsDocumentError,
    apply_document_update,
    state_from_markdown,
)
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    IdentityServiceDependency,
    RateLimiterDependency,
    SettingsDependency,
    request_id,
)
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.service import not_found
from logion_api.reading.note_template import TEMPLATE, fill_sections, missing_sections

router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources/{resource_id}",
    tags=["research-reading"],
    dependencies=[Depends(require_enabled)],
)


class ReadingNote(BaseModel):
    id: UUID
    resource_id: UUID
    note_kind: Literal["close_reading"] = "close_reading"
    markdown_body: str
    yjs_state_base64: str
    yjs_generation: int
    version: int
    missing_sections: list[str]


def note_response(note: Note) -> ReadingNote:
    assert note.resource_id is not None
    return ReadingNote(
        id=note.id,
        resource_id=note.resource_id,
        markdown_body=note.markdown_body,
        yjs_state_base64=base64.b64encode(note.yjs_state).decode("ascii"),
        yjs_generation=note.yjs_generation,
        version=note.version,
        missing_sections=missing_sections(note.markdown_body),
    )


async def load_note(db: AsyncSession, resource: Resource, *, write: bool = False) -> Note | None:
    query = select(Note).where(
        Note.resource_id == resource.id,
        Note.research_owner_id == resource.research_owner_id,
        Note.workspace_id == resource.workspace_id,
        Note.space_id == resource.space_id,
        Note.note_kind == "close_reading",
        Note.deleted_at.is_(None),
    )
    if write:
        query = query.with_for_update()
    note: Note | None = await db.scalar(query)
    return note


@router.get("/note", response_model=ReadingNote | None, operation_id="reading_note_get")
async def get_note(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingNote | None:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    note = await load_note(db, resource)
    return note_response(note) if note else None


@router.post(
    "/note",
    response_model=ReadingNote,
    operation_id="reading_note_create",
    dependencies=[Depends(write_boundary)],
)
async def create_note(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingNote:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    note = await load_note(db, resource, write=True)
    if note is None:
        note = Note(
            workspace_id=workspace_id,
            space_id=space_id,
            resource_id=resource.id,
            research_owner_id=context.user.id,
            note_kind="close_reading",
            title=resource.title[:200],
            markdown_body=TEMPLATE,
            yjs_state=state_from_markdown(TEMPLATE),
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(note)
        await db.flush()
        service.audit(db, context, request_id(request), "reading_note_created")
    result = note_response(note)
    await db.commit()
    return result


class ReadingNoteUpdate(NoteDocumentUpdate):
    base_version: int = Field(ge=1)


@router.patch(
    "/note/document",
    response_model=ReadingNote,
    operation_id="reading_note_update",
    dependencies=[Depends(write_boundary)],
)
async def update_note(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: ReadingNoteUpdate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> ReadingNote:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    note = await load_note(db, resource, write=True)
    if note is None or payload.space_id != space_id:
        raise not_found()
    if payload.base_version > note.version or payload.yjs_generation != note.yjs_generation:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT",
            message="Reopen the latest note document.",
            status_code=409,
        )
    try:
        snapshot = apply_document_update(note.yjs_state, payload.decoded_update())
    except (ValueError, YjsDocumentError) as exc:
        raise APIError(
            code="NOTE_DOCUMENT_UPDATE_INVALID",
            message="The note update is invalid or too large.",
            status_code=422,
        ) from exc
    if snapshot.state != note.yjs_state:
        note.yjs_state, note.markdown_body = snapshot.state, snapshot.markdown
        note.version += 1
        note.updated_at, note.updated_by = utc_now(), context.user.id
        service.audit(db, context, request_id(request), "reading_note_saved")
    result = note_response(note)
    await db.commit()
    return result


class ReadingNoteRuns(BaseModel):
    runs: list[ResearchRunResult]


@router.get("/note/ai-runs", response_model=ReadingNoteRuns, operation_id="reading_note_ai_runs")
async def note_runs(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    runs: AIRunServiceDependency,
) -> ReadingNoteRuns:
    await runs.authorize(db, context, workspace_id, request_id(request))
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    note = await load_note(db, resource)
    if note is None:
        return ReadingNoteRuns(runs=[])
    rows = (
        await db.execute(
            select(AIRun, AIOutputDraft)
            .outerjoin(AIOutputDraft, AIOutputDraft.run_id == AIRun.id)
            .where(
                AIRun.workspace_id == workspace_id,
                AIRun.requested_by == context.user.id,
                AIRun.target_type == "note",
                AIRun.target_id == note.id,
                AIRun.task_type == "close_reading",
                (AIOutputDraft.status == "pending") | AIOutputDraft.id.is_(None),
            )
            .order_by(AIRun.created_at.desc(), AIRun.id)
            .limit(20)
        )
    ).all()
    return ReadingNoteRuns(
        runs=[
            ResearchRunResult(run=run_response(run), draft=draft_response(draft) if draft else None)
            for run, draft in rows
        ]
    )


class ReadingNoteDraftDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["accepted", "rejected"]
    expected_note_version: int = Field(ge=1)
    expected_draft_version: int = Field(ge=1)


@router.post(
    "/note/drafts/{draft_id}/decision",
    response_model=ReadingNote,
    operation_id="reading_note_draft_decide",
    dependencies=[Depends(write_boundary)],
)
async def decide_note_draft(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    draft_id: UUID,
    payload: ReadingNoteDraftDecision,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
    runs: AIRunServiceDependency,
    identity: IdentityServiceDependency,
    limiter: RateLimiterDependency,
    settings: SettingsDependency,
    x_csrf_token: str | None = Header(default=None),
) -> ReadingNote:
    await run_write_boundary(
        request, context, identity, limiter, settings, workspace_id, x_csrf_token
    )
    await runs.authorize(db, context, workspace_id, request_id(request))
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    note = await load_note(db, resource, write=True)
    if note is None:
        raise not_found()
    pair = (
        await db.execute(
            select(AIOutputDraft, AIRun)
            .join(AIRun, AIRun.id == AIOutputDraft.run_id)
            .where(
                AIOutputDraft.id == draft_id,
                AIOutputDraft.workspace_id == workspace_id,
                AIRun.workspace_id == workspace_id,
                AIRun.requested_by == context.user.id,
                AIRun.task_type == "close_reading",
                AIRun.target_type == "note",
                AIRun.target_id == note.id,
                AIRun.status == "succeeded",
                AIRun.prompt_version == "research-v1/close_reading",
                AIOutputDraft.target_type == "note",
                AIOutputDraft.target_id == note.id,
                AIOutputDraft.target_version == AIRun.target_version,
            )
            .with_for_update()
        )
    ).one_or_none()
    if pair is None:
        raise not_found()
    draft, run = pair
    if draft.status != "pending" or draft.version != payload.expected_draft_version:
        raise APIError(
            code="AI_DRAFT_TERMINAL",
            message="The draft has changed or was already decided.",
            status_code=409,
        )
    if payload.decision == "accepted":
        if note.version != payload.expected_note_version or note.version != run.target_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The note changed since this draft was requested.",
                status_code=409,
            )
        output = draft.structured_output
        if (
            not output
            or set(output) != set(run.expected_output_fields)
            or not set(output).issubset(missing_sections(note.markdown_body))
            or any(
                not isinstance(value, str)
                or not value.strip()
                or len(value) > 20000
                or "\x00" in value
                for value in output.values()
            )
        ):
            raise APIError(
                code="AI_DRAFT_SCHEMA_INVALID",
                message="The draft must fill only missing reading sections.",
                status_code=422,
            )
        markdown = fill_sections(note.markdown_body, output)
        try:
            state = state_from_markdown(markdown)
        except YjsDocumentError as exc:
            raise APIError(
                code="NOTE_DOCUMENT_TOO_LARGE", message="The note is too large.", status_code=422
            ) from exc
        note.markdown_body, note.yjs_state = markdown, state
        note.yjs_generation += 1
        note.version += 1
        note.updated_by, note.updated_at = context.user.id, utc_now()
    draft.status, draft.decided_by, draft.decided_at = payload.decision, context.user.id, utc_now()
    draft.updated_at = utc_now()
    draft.version += 1
    service.audit(db, context, request_id(request), f"reading_note_draft_{payload.decision}")
    result = note_response(note)
    await db.commit()
    return result
