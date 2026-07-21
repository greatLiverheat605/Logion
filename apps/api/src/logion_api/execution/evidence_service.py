from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.execution.evidence_models import EvidenceItem, VerificationRecord
from logion_api.execution.evidence_schemas import EvidenceSubmitRequest
from logion_api.execution.models import Task
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService


@dataclass(frozen=True)
class EvidenceAggregate:
    evidence: EvidenceItem
    verification: VerificationRecord
    task: Task


class EvidenceService:
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
        permission: Permission,
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
                permission=permission,
            )

    async def submit(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: EvidenceSubmitRequest,
        request_id: str,
    ) -> EvidenceAggregate:
        await self._authorize(
            db, context, workspace_id, space_id, request_id, Permission.EVIDENCE_SUBMIT
        )
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        count = int(
            await db.scalar(
                select(func.count(EvidenceItem.id)).where(
                    EvidenceItem.workspace_id == workspace_id,
                    EvidenceItem.space_id == space_id,
                    EvidenceItem.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self._settings.evidence_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED", message="Evidence quota reached.", status_code=409
            )
        task = await db.scalar(
            select(Task)
            .where(
                Task.id == payload.task_id,
                Task.workspace_id == workspace_id,
                Task.space_id == space_id,
                Task.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if task is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if task.status not in {"in_progress", "submitted"}:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT",
                message="Task is not ready for evidence.",
                status_code=409,
            )
        if payload.note_id is not None:
            exists = await db.scalar(
                select(Note.id).where(
                    Note.id == payload.note_id,
                    Note.workspace_id == workspace_id,
                    Note.space_id == space_id,
                    Note.deleted_at.is_(None),
                )
            )
            if exists is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
                )
        if payload.resource_id is not None:
            exists = await db.scalar(
                select(Resource.id).where(
                    Resource.id == payload.resource_id,
                    Resource.workspace_id == workspace_id,
                    Resource.space_id == space_id,
                    Resource.deleted_at.is_(None),
                )
            )
            if exists is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
                )
        if (
            await db.get(EvidenceItem, payload.evidence_id) is not None
            or await db.get(VerificationRecord, payload.verification_id) is not None
        ):
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        now = utc_now()
        if task.status == "in_progress":
            task.status = "submitted"
            task.version += 1
            task.updated_by = context.user.id
            task.updated_at = now
        evidence = EvidenceItem(
            id=payload.evidence_id,
            workspace_id=workspace_id,
            space_id=space_id,
            task_id=task.id,
            evidence_type=payload.evidence_type,
            note_id=payload.note_id,
            resource_id=payload.resource_id,
            summary=payload.summary,
            external_url=payload.external_url,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(evidence)
        await db.flush()
        verification = VerificationRecord(
            id=payload.verification_id,
            workspace_id=workspace_id,
            space_id=space_id,
            task_id=task.id,
            evidence_id=evidence.id,
            requested_by=context.user.id,
        )
        db.add(verification)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="verification.evidence_submitted",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="evidence",
                target_id=evidence.id,
                metadata={"evidence_type": evidence.evidence_type, "task_id": str(task.id)},
            )
        )
        return EvidenceAggregate(evidence, verification, task)

    async def decide(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        verification_id: UUID,
        expected_version: int,
        verdict: str,
        reviewer_notes: str,
        request_id: str,
    ) -> EvidenceAggregate:
        await self._authorize(
            db, context, workspace_id, space_id, request_id, Permission.REVIEW_WRITE
        )
        candidate = await db.scalar(
            select(VerificationRecord).where(
                VerificationRecord.id == verification_id,
                VerificationRecord.workspace_id == workspace_id,
                VerificationRecord.space_id == space_id,
            )
        )
        if candidate is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        task = await db.scalar(
            select(Task)
            .where(Task.id == candidate.task_id, Task.workspace_id == workspace_id)
            .with_for_update()
        )
        verification = await db.scalar(
            select(VerificationRecord)
            .where(
                VerificationRecord.id == verification_id,
                VerificationRecord.workspace_id == workspace_id,
            )
            .with_for_update()
        )
        if task is None or verification is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        if verification.version != expected_version or verification.verdict != "pending":
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Verification changed.", status_code=409
            )
        if task.status != "submitted":
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Task is not submitted.", status_code=409
            )
        now = utc_now()
        verification.verdict = verdict
        verification.reviewer_notes = reviewer_notes
        verification.version += 1
        verification.decided_by = context.user.id
        verification.decided_at = now
        verification.updated_at = now
        task.status = "verified" if verdict == "passed" else "in_progress"
        task.version += 1
        task.updated_by = context.user.id
        task.updated_at = now
        evidence = await db.get(EvidenceItem, verification.evidence_id)
        assert evidence is not None
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="verification.decision_recorded",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="verification",
                target_id=verification.id,
                metadata={"verdict": verdict, "task_id": str(task.id)},
            )
        )
        return EvidenceAggregate(evidence, verification, task)

    async def close_task(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        task_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> Task:
        await self._authorize(
            db, context, workspace_id, space_id, request_id, Permission.REVIEW_WRITE
        )
        task = await db.scalar(
            select(Task)
            .where(
                Task.id == task_id,
                Task.workspace_id == workspace_id,
                Task.space_id == space_id,
                Task.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if task is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404
            )
        passed = await db.scalar(
            select(VerificationRecord.id).where(
                VerificationRecord.task_id == task.id,
                VerificationRecord.workspace_id == workspace_id,
                VerificationRecord.verdict == "passed",
            )
        )
        if task.version != expected_version or task.status != "verified" or passed is None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Task is not verified.", status_code=409
            )
        task.status = "done"
        task.version += 1
        task.updated_by = context.user.id
        task.updated_at = utc_now()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="verification.task_closed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="task",
                target_id=task.id,
                metadata={"task_version": task.version},
            )
        )
        return task
