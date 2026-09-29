import hashlib
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.content.models import Note
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.library.service import not_found
from logion_api.memory.models import KnowledgeSourceLink, QuizItem, Topic, TopicDependency
from logion_api.memory.online_schemas import OnlineNoteSource
from logion_api.sync.deletion import deletion_scope, require_unreferenced
from logion_api.sync.models import WorkspaceSyncState
from logion_api.sync.push import canonical_hash
from logion_api.sync.service import AppliedSyncChange, SyncLedgerService, SyncOperationIdentity
from logion_api.workspaces.service import WorkspaceService

MemoryKind = Literal["topic", "quiz_item", "topic_dependency"]
MODELS = {"topic": Topic, "quiz_item": QuizItem, "topic_dependency": TopicDependency}


def topics(workspace_id: UUID, space_id: UUID) -> Select[tuple[Topic]]:
    return select(Topic).where(
        Topic.workspace_id == workspace_id,
        Topic.space_id == space_id,
        Topic.research_owner_id.is_(None),
        Topic.deleted_at.is_(None),
    )


async def target(
    db: AsyncSession, workspace_id: UUID, space_id: UUID, kind: MemoryKind, identifier: UUID
) -> Any:
    model: Any = MODELS[kind]
    query = select(model).where(
        model.id == identifier,
        model.workspace_id == workspace_id,
        model.space_id == space_id,
        model.deleted_at.is_(None),
    )
    if kind != "topic_dependency":
        query = query.where(model.research_owner_id.is_(None))
    row = await db.scalar(query)
    if row is None:
        raise not_found()
    return row


async def append(
    db: AsyncSession,
    context: AuthContext,
    state: WorkspaceSyncState,
    kind: str,
    row: Any,
    payload: dict[str, object],
    *,
    deleted: bool = False,
) -> None:
    await db.flush()
    digest = canonical_hash(payload)
    await SyncLedgerService().append_applied(
        db,
        state,
        SyncOperationIdentity(
            operation_id=uuid7(),
            workspace_id=row.workspace_id,
            device_id=context.device.id,
            payload_hash=digest,
            operation_fingerprint=digest,
            entity_type=kind,
            entity_id=row.id,
            operation_type="delete" if deleted else "create" if row.version == 1 else "update",
        ),
        AppliedSyncChange(
            server_version=row.version,
            payload=payload,
            payload_hash=digest,
            tombstone=deleted,
            deleted_at=row.deleted_at if deleted else None,
        ),
    )


async def retire(
    db: AsyncSession,
    workspaces: WorkspaceService,
    context: AuthContext,
    state: WorkspaceSyncState,
    workspace_id: UUID,
    space_id: UUID,
    kind: MemoryKind,
    identifier: UUID,
    version: int,
    request_id: str,
) -> None:
    await target(db, workspace_id, space_id, kind, identifier)
    scope = await deletion_scope(
        db, workspaces, context, workspace_id, kind, identifier, request_id
    )
    require_unreferenced(scope)
    if scope.root.deleted_at is not None or scope.root.version != version:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT", message="The item changed.", status_code=409
        )
    # Same ADR-0031/0036 closure as the legacy writer: histories are never deleted.
    now = utc_now()
    assert not scope.detached
    for child_kind, child in scope.deleted:
        if child.deleted_at is None:
            child.deleted_at = child.updated_at = now
            child.updated_by = context.user.id
            child.version += 1
            await append(db, context, state, child_kind, child, {}, deleted=True)
    db.add(
        new_audit_event(
            request_id=request_id,
            event_type="memory.online_retired",
            result="success",
            actor_id=context.user.id,
            workspace_id=workspace_id,
            target_type=kind,
            target_id=identifier,
        )
    )


async def source_view(
    db: AsyncSession,
    workspace_id: UUID,
    space_id: UUID,
    link: KnowledgeSourceLink,
    *,
    locate: bool = False,
) -> OnlineNoteSource:
    kind: Literal["topic", "quiz_item"] = "topic" if link.target_kind == "topic" else "quiz_item"
    item = await target(db, workspace_id, space_id, kind, link.target_id)
    # A source can have disappeared; do not expose a moved/private note's metadata.
    note = await db.scalar(
        select(Note).where(
            Note.id == link.source_id,
            Note.workspace_id == workspace_id,
            Note.space_id == space_id,
            Note.research_owner_id.is_(None),
        )
    )
    view = OnlineNoteSource(
        id=link.id, note_id=link.source_id, note_title=None, state="unavailable"
    )
    if note is None:
        return view
    if note.deleted_at is not None:
        view.state = "deleted"
        return view
    view.note_title = note.title
    text = item.description if kind == "topic" else item.explanation
    excerpt = text.split("\n\n", 1)[1] if text.startswith("来源笔记：") and "\n\n" in text else None
    if excerpt and hashlib.sha256(excerpt.encode("utf-8")).hexdigest() == link.excerpt_sha256:
        position = note.markdown_body.find(excerpt)
        view.state = "valid" if position >= 0 else "modified"
        if locate and position >= 0:
            view.start = len(note.markdown_body[:position].encode("utf-16-le")) // 2
            view.end = view.start + len(excerpt.encode("utf-16-le")) // 2
    else:
        view.state = "valid" if note.version <= max(link.source_version, 1) else "modified"
    if (
        locate
        and view.start is None
        and link.excerpt_start is not None
        and link.excerpt_end is not None
        and link.excerpt_end <= len(note.markdown_body.encode("utf-16-le")) // 2
    ):
        view.start, view.end = link.excerpt_start, link.excerpt_end
    return view


def source_query(workspace_id: UUID, space_id: UUID) -> Select[tuple[KnowledgeSourceLink]]:
    return select(KnowledgeSourceLink).where(
        KnowledgeSourceLink.workspace_id == workspace_id,
        KnowledgeSourceLink.space_id == space_id,
        KnowledgeSourceLink.deleted_at.is_(None),
    )


def dependency_query(
    workspace_id: UUID, space_id: UUID, topic_id: UUID
) -> Select[tuple[TopicDependency]]:
    return select(TopicDependency).where(
        TopicDependency.workspace_id == workspace_id,
        TopicDependency.space_id == space_id,
        TopicDependency.deleted_at.is_(None),
        or_(
            TopicDependency.prerequisite_topic_id == topic_id,
            TopicDependency.dependent_topic_id == topic_id,
        ),
    )
