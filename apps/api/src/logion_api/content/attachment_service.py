import secrets
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.attachment_schemas import AttachmentInit
from logion_api.content.attachment_storage import (
    AttachmentStorageError,
    FilesystemAttachmentStorage,
)
from logion_api.content.models import Attachment, Note
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.research.models import ExperimentRun
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


class AttachmentService:
    def __init__(
        self,
        settings: Settings,
        workspaces: WorkspaceService,
        storage: FilesystemAttachmentStorage,
    ) -> None:
        self._settings = settings
        self._workspaces = workspaces
        self._storage = storage

    async def _authorize_write(
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

    async def _validate_target(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        target_type: str,
        target_id: UUID,
    ) -> None:
        query = None
        if target_type == "note":
            query = select(Note.id).where(
                Note.id == target_id,
                Note.workspace_id == workspace_id,
                Note.space_id == space_id,
                Note.deleted_at.is_(None),
            )
        elif target_type == "evidence_item":
            query = select(EvidenceItem.id).where(
                EvidenceItem.id == target_id,
                EvidenceItem.workspace_id == workspace_id,
                EvidenceItem.space_id == space_id,
                EvidenceItem.deleted_at.is_(None),
            )
        elif target_type == "experiment_run":
            query = select(ExperimentRun.id).where(
                ExperimentRun.id == target_id,
                ExperimentRun.workspace_id == workspace_id,
                ExperimentRun.space_id == space_id,
                ExperimentRun.user_id == context.user.id,
                ExperimentRun.deleted_at.is_(None),
            )
        if query is None or await db.scalar(query) is None:
            raise self._not_found()

    async def initiate(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: AttachmentInit,
        request_id: str,
    ) -> Attachment:
        await self._authorize_write(db, context, workspace_id, space_id, request_id)
        await self._validate_target(
            db,
            context,
            workspace_id,
            space_id,
            payload.target_type,
            payload.target_id,
        )
        if payload.size_bytes > self._settings.attachment_max_bytes:
            raise APIError(
                code="ATTACHMENT_TOO_LARGE",
                message="The attachment exceeds the configured limit.",
                status_code=413,
            )
        existing = await db.get(Attachment, payload.id)
        if existing is not None:
            if existing.workspace_id != workspace_id or existing.created_by != context.user.id:
                raise self._not_found()
            identity = (
                existing.space_id,
                existing.target_type,
                existing.target_id,
                existing.filename,
                existing.declared_mime,
                existing.size_bytes,
                existing.expected_sha256,
            )
            requested = (
                space_id,
                payload.target_type,
                payload.target_id,
                payload.filename,
                payload.declared_mime,
                payload.size_bytes,
                payload.sha256,
            )
            if identity != requested or existing.status == "deleted":
                raise self._conflict("The attachment identifier has different content.")
            return existing
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        reserved = int(
            await db.scalar(
                select(func.coalesce(func.sum(Attachment.size_bytes), 0)).where(
                    Attachment.created_by == context.user.id,
                    Attachment.status != "deleted",
                )
            )
            or 0
        )
        if reserved + payload.size_bytes > self._settings.attachment_user_quota_bytes:
            raise APIError(
                code="ATTACHMENT_QUOTA_EXCEEDED",
                message="The attachment storage quota would be exceeded.",
                status_code=409,
            )
        row = Attachment(
            id=payload.id,
            workspace_id=workspace_id,
            space_id=space_id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            filename=payload.filename,
            declared_mime=payload.declared_mime,
            size_bytes=payload.size_bytes,
            expected_sha256=payload.sha256,
            staging_key=secrets.token_hex(16),
            created_by=context.user.id,
        )
        try:
            async with db.begin_nested():
                db.add(row)
                await db.flush()
        except IntegrityError as exc:
            raise self._conflict("The attachment identifier already exists.") from exc
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="attachment.initiated",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="attachment",
                target_id=row.id,
                metadata={
                    "target_type": row.target_type,
                    "size_bytes": row.size_bytes,
                    "declared_mime": row.declared_mime,
                },
            )
        )
        return row

    async def upload(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        attachment_id: UUID,
        stream: AsyncIterator[bytes],
        request_id: str,
    ) -> Attachment:
        await self._authorize_write(db, context, workspace_id, space_id, request_id)
        row = await self._owned_for_update(db, context, workspace_id, space_id, attachment_id)
        if row.status in {"verified", "deleted"}:
            raise self._conflict("A verified or deleted attachment cannot be overwritten.")
        try:
            received = await self._storage.write_staging(
                row.staging_key, stream, maximum_bytes=row.size_bytes
            )
        except AttachmentStorageError as exc:
            await self._fail(db, row, str(exc))
            raise self._invalid(str(exc)) from exc
        if received != row.size_bytes:
            await self._fail(db, row, "ATTACHMENT_SIZE_MISMATCH")
            raise self._invalid("ATTACHMENT_SIZE_MISMATCH")
        row.status = "uploading"
        row.failure_code = None
        row.version += 1
        row.updated_at = utc_now()
        await db.flush()
        return row

    async def complete(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        attachment_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> Attachment:
        await self._authorize_write(db, context, workspace_id, space_id, request_id)
        row = await self._owned_for_update(db, context, workspace_id, space_id, attachment_id)
        if row.status == "verified":
            return row
        if row.status == "deleted":
            raise self._not_found()
        if row.version != expected_version:
            raise self._conflict("The attachment changed.")
        if row.status != "uploading":
            raise self._conflict("Attachment content has not been uploaded.")
        try:
            inspection = await self._storage.inspect(
                row.staging_key,
                declared_mime=row.declared_mime,
                maximum_bytes=self._settings.attachment_max_bytes,
            )
            if inspection.detected_mime != row.declared_mime:
                raise AttachmentStorageError("ATTACHMENT_MIME_MISMATCH")
            if inspection.size_bytes != row.size_bytes:
                raise AttachmentStorageError("ATTACHMENT_SIZE_MISMATCH")
            if inspection.sha256 != row.expected_sha256:
                raise AttachmentStorageError("ATTACHMENT_HASH_MISMATCH")
            storage_key = f"{workspace_id}/{row.id}"
            await self._storage.finalize(row.staging_key, storage_key)
        except AttachmentStorageError as exc:
            await self._fail(db, row, str(exc))
            raise self._invalid(str(exc)) from exc
        row.status = "verified"
        row.detected_mime = inspection.detected_mime
        row.verified_sha256 = inspection.sha256
        row.storage_key = storage_key
        row.failure_code = None
        row.version += 1
        row.updated_at = utc_now()
        row.verified_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="attachment.verified",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="attachment",
                target_id=row.id,
                metadata={
                    "target_type": row.target_type,
                    "size_bytes": row.size_bytes,
                    "detected_mime": row.detected_mime,
                },
            )
        )
        await db.flush()
        return row

    async def download_path(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        attachment_id: UUID,
        request_id: str,
    ) -> tuple[Attachment, Path]:
        await self._workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        row = await db.scalar(
            select(Attachment).where(
                Attachment.id == attachment_id,
                Attachment.workspace_id == workspace_id,
                Attachment.space_id == space_id,
                Attachment.status == "verified",
            )
        )
        if row is None or row.storage_key is None:
            raise self._not_found()
        await self._validate_target(
            db, context, workspace_id, space_id, row.target_type, row.target_id
        )
        try:
            return row, self._storage.verified_path(row.storage_key)
        except AttachmentStorageError as exc:
            raise APIError(
                code="ATTACHMENT_STORAGE_UNAVAILABLE",
                message="The attachment is temporarily unavailable.",
                status_code=503,
            ) from exc

    async def cleanup_staging(self, row: Attachment) -> None:
        try:
            await self._storage.discard_staging(row.staging_key)
        except OSError:
            return

    async def _owned_for_update(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        attachment_id: UUID,
    ) -> Attachment:
        row = await db.scalar(
            select(Attachment)
            .where(
                Attachment.id == attachment_id,
                Attachment.workspace_id == workspace_id,
                Attachment.space_id == space_id,
                Attachment.created_by == context.user.id,
            )
            .with_for_update()
        )
        if row is None:
            raise self._not_found()
        return row

    @staticmethod
    async def _fail(db: AsyncSession, row: Attachment, code: str) -> None:
        row.status = "failed"
        row.failure_code = code[:64]
        row.version += 1
        row.updated_at = utc_now()
        await db.flush()

    @staticmethod
    def _not_found() -> APIError:
        return APIError(code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404)

    @staticmethod
    def _conflict(message: str) -> APIError:
        return APIError(code="RESOURCE_VERSION_CONFLICT", message=message, status_code=409)

    @staticmethod
    def _invalid(code: str) -> APIError:
        return APIError(code=code, message="Attachment verification failed.", status_code=422)
