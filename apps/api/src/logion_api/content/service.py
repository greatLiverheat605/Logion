from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.content.schemas import NoteUpdateRequest, NoteWriteRequest, ResourceFields
from logion_api.content.yjs_documents import (
    YjsDocumentError,
    apply_document_update,
    state_from_markdown,
)
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.models import Task
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


class ContentService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces

    async def _authorize(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> None:
        space = await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if space.visibility == "shared":
            await self._workspaces.resolve_workspace(
                db,
                context,
                workspace_id,
                request_id=request_id,
                permission=Permission.SHARED_PLAN_WRITE,
            )

    async def _validate_task(
        self, db: AsyncSession, workspace_id: UUID, space_id: UUID, task_id: UUID | None
    ) -> None:
        if task_id is None:
            return
        task = await db.scalar(
            select(Task.id).where(
                Task.id == task_id,
                Task.workspace_id == workspace_id,
                Task.space_id == space_id,
                Task.deleted_at.is_(None),
            )
        )
        if task is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )

    async def _quota(self, db: AsyncSession, workspace_id: UUID, space_id: UUID) -> None:
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        notes = int(
            await db.scalar(
                select(func.count(Note.id)).where(
                    Note.workspace_id == workspace_id,
                    Note.space_id == space_id,
                    Note.deleted_at.is_(None),
                )
            )
            or 0
        )
        resources = int(
            await db.scalar(
                select(func.count(Resource.id)).where(
                    Resource.workspace_id == workspace_id,
                    Resource.space_id == space_id,
                    Resource.deleted_at.is_(None),
                )
            )
            or 0
        )
        if notes + resources >= self._settings.content_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="The Space has reached its content limit.",
                status_code=409,
            )

    async def create_note(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: NoteWriteRequest,
        request_id: str,
    ) -> Note:
        await self._authorize(db, context, workspace_id, space_id, request_id)
        await self._validate_task(db, workspace_id, space_id, payload.task_id)
        await self._quota(db, workspace_id, space_id)
        if await db.get(Note, payload.id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        note = Note(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            task_id=payload.task_id,
            title=payload.title,
            markdown_body=payload.markdown_body,
            yjs_state=state_from_markdown(payload.markdown_body),
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(note)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="content.note_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="note",
                target_id=note.id,
                metadata={"has_task": note.task_id is not None},
            )
        )
        return note

    async def update_note(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        note_id: UUID,
        payload: NoteUpdateRequest,
        request_id: str,
    ) -> Note:
        await self._authorize(db, context, workspace_id, space_id, request_id)
        await self._validate_task(db, workspace_id, space_id, payload.task_id)
        note = await db.scalar(
            select(Note)
            .where(
                Note.id == note_id,
                Note.workspace_id == workspace_id,
                Note.space_id == space_id,
                Note.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if note is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if note.version != payload.expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="The note changed.", status_code=409
            )
        note.task_id = payload.task_id
        note.title = payload.title
        note.markdown_body = payload.markdown_body
        note.yjs_state = state_from_markdown(payload.markdown_body)
        note.yjs_generation += 1
        note.version += 1
        note.updated_by = context.user.id
        note.updated_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="content.note_updated",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="note",
                target_id=note.id,
                metadata={"version": note.version, "has_task": note.task_id is not None},
            )
        )
        return note

    async def apply_note_document_update(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        note_id: UUID,
        base_version: int,
        yjs_generation: int,
        update: bytes,
        request_id: str,
    ) -> Note:
        await self._authorize(db, context, workspace_id, space_id, request_id)
        note = await db.scalar(
            select(Note)
            .where(
                Note.id == note_id,
                Note.workspace_id == workspace_id,
                Note.space_id == space_id,
                Note.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if note is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if base_version < 1 or base_version > note.version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The note document base version is invalid.",
                status_code=409,
            )
        if yjs_generation != note.yjs_generation:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="The note document generation changed.",
                status_code=409,
            )
        try:
            snapshot = apply_document_update(note.yjs_state, update)
        except YjsDocumentError as exc:
            raise APIError(
                code=str(exc), message="The note document update is invalid.", status_code=422
            ) from exc
        note.yjs_state = snapshot.state
        note.markdown_body = snapshot.markdown
        note.version += 1
        note.updated_by = context.user.id
        note.updated_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="content.note_document_updated",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="note",
                target_id=note.id,
                metadata={"version": note.version, "update_bytes": len(update)},
            )
        )
        return note

    async def create_resource(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        resource_id: UUID,
        payload: ResourceFields,
        request_id: str,
    ) -> Resource:
        await self._authorize(db, context, workspace_id, space_id, request_id)
        await self._validate_task(db, workspace_id, space_id, payload.task_id)
        await self._quota(db, workspace_id, space_id)
        if await db.get(Resource, resource_id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        resource = Resource(
            id=resource_id,
            workspace_id=workspace_id,
            space_id=space_id,
            task_id=payload.task_id,
            resource_type=payload.resource_type,
            title=payload.title,
            source_url=payload.source_url,
            pdf_filename=payload.pdf_filename,
            page_count=payload.page_count,
            sha256=payload.sha256,
            page_index=[item.model_dump() for item in payload.page_index],
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(resource)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="content.resource_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="resource",
                target_id=resource.id,
                metadata={
                    "resource_type": resource.resource_type,
                    "page_entries": len(resource.page_index),
                },
            )
        )
        return resource

    async def update_resource(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        resource_id: UUID,
        expected_version: int,
        payload: ResourceFields,
        request_id: str,
    ) -> Resource:
        await self._authorize(db, context, workspace_id, space_id, request_id)
        await self._validate_task(db, workspace_id, space_id, payload.task_id)
        resource = await db.scalar(
            select(Resource)
            .where(
                Resource.id == resource_id,
                Resource.workspace_id == workspace_id,
                Resource.space_id == space_id,
                Resource.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if resource is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if resource.version != expected_version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="The resource changed.", status_code=409
            )
        for field in (
            "task_id",
            "resource_type",
            "title",
            "source_url",
            "pdf_filename",
            "page_count",
            "sha256",
        ):
            setattr(resource, field, getattr(payload, field))
        resource.page_index = [item.model_dump() for item in payload.page_index]
        resource.version += 1
        resource.updated_by = context.user.id
        resource.updated_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="content.resource_updated",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="resource",
                target_id=resource.id,
                metadata={"version": resource.version, "page_entries": len(resource.page_index)},
            )
        )
        return resource
