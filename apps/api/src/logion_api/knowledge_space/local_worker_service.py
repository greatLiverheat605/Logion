"""Authenticated persistence boundary for the Local Worker protocol.

The worker never receives a database object or a raw payload.  The API creates
short-lived leases, stores only token digests, and binds every checkpoint/result
to the immutable job scope and input digest.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Final, cast
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.db import utc_now
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.errors import (
    local_worker_idempotency_conflict_error,
    local_worker_lease_expired_error,
    local_worker_scope_conflict_error,
    local_worker_state_conflict_error,
    local_worker_token_invalid_error,
    resource_not_found_error,
)
from logion_api.knowledge_space.models import (
    LocalWorkerCheckpoint,
    LocalWorkerJob,
    LocalWorkerLease,
    LocalWorkerResultReceipt,
)
from logion_api.knowledge_space.schemas import (
    LocalWorkerCheckpointRequest,
    LocalWorkerJobState,
    LocalWorkerLeaseCreateRequest,
    LocalWorkerLeaseState,
    LocalWorkerResultRequest,
    LocalWorkerStage,
)
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import WorkspaceRole

_STAGE_ORDER: Final[dict[LocalWorkerStage, int]] = {
    LocalWorkerStage.CLAIMED: 0,
    LocalWorkerStage.RUNNING: 1,
    LocalWorkerStage.UPLOADED: 2,
}


class LocalWorkerService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def issue_lease(
        self,
        db: AsyncSession,
        context: AuthContext,
        payload: LocalWorkerLeaseCreateRequest,
        *,
        request_id: str,
    ) -> tuple[LocalWorkerLease, str]:
        await self._resolve_private_owner_scope(db, context, payload.workspace_id, payload.space_id)
        now = utc_now()
        job = await db.scalar(
            select(LocalWorkerJob)
            .where(
                LocalWorkerJob.id == payload.job_id,
                LocalWorkerJob.workspace_id == payload.workspace_id,
            )
            .with_for_update()
        )
        if job is not None:
            if (
                job.space_id != payload.space_id
                or job.created_by != context.user.id
                or job.input_sha256 != payload.input_sha256
            ):
                raise local_worker_scope_conflict_error()
            if job.state == LocalWorkerJobState.COMPLETED:
                raise local_worker_state_conflict_error()
        else:
            job = LocalWorkerJob(
                id=payload.job_id,
                workspace_id=payload.workspace_id,
                space_id=payload.space_id,
                created_by=context.user.id,
                input_sha256=payload.input_sha256,
                state=LocalWorkerJobState.QUEUED,
                created_at=now,
                updated_at=now,
            )
            db.add(job)
            try:
                await db.flush()
            except IntegrityError as exc:
                raise local_worker_scope_conflict_error() from exc

        active_leases = list(
            (
                await db.scalars(
                    select(LocalWorkerLease)
                    .where(
                        LocalWorkerLease.job_id == job.id,
                        LocalWorkerLease.workspace_id == job.workspace_id,
                        LocalWorkerLease.state == LocalWorkerLeaseState.ACTIVE,
                    )
                    .with_for_update()
                )
            ).all()
        )
        for active in active_leases:
            if active.expires_at <= now:
                active.state = LocalWorkerLeaseState.EXPIRED
            else:
                raise local_worker_state_conflict_error()

        token = secrets.token_urlsafe(32)
        lease = LocalWorkerLease(
            id=UUID(int=secrets.randbits(128)),
            job_id=job.id,
            workspace_id=job.workspace_id,
            space_id=job.space_id,
            token_sha256=_digest(token),
            issued_at=now,
            expires_at=now + timedelta(seconds=self._settings.local_worker_lease_seconds),
            state=LocalWorkerLeaseState.ACTIVE,
        )
        db.add(lease)
        job.updated_at = now
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="knowledge.local_worker_lease_issued",
                result="success",
                actor_id=context.user.id,
                workspace_id=job.workspace_id,
                target_type="local_worker_job",
                target_id=job.id,
                metadata={"space_id": str(job.space_id)},
            )
        )
        return lease, token

    async def revoke_lease(
        self,
        db: AsyncSession,
        context: AuthContext,
        lease_id: UUID,
        *,
        request_id: str,
    ) -> LocalWorkerLease:
        result = await db.execute(
            select(LocalWorkerLease, LocalWorkerJob, WorkspaceMembership, Space)
            .join(
                LocalWorkerJob,
                (LocalWorkerJob.id == LocalWorkerLease.job_id)
                & (LocalWorkerJob.workspace_id == LocalWorkerLease.workspace_id),
            )
            .join(
                Space,
                (Space.id == LocalWorkerLease.space_id)
                & (Space.workspace_id == LocalWorkerLease.workspace_id),
            )
            .join(
                Workspace,
                Workspace.id == LocalWorkerLease.workspace_id,
            )
            .join(
                WorkspaceMembership,
                (WorkspaceMembership.workspace_id == LocalWorkerLease.workspace_id)
                & (WorkspaceMembership.user_id == context.user.id),
            )
            .where(
                LocalWorkerLease.id == lease_id,
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
                WorkspaceMembership.status == "active",
                Space.status == "active",
                Space.deleted_at.is_(None),
                Space.visibility == "private",
                or_(
                    LocalWorkerJob.created_by == context.user.id,
                    WorkspaceMembership.role.in_([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]),
                ),
            )
            .with_for_update()
        )
        row = result.one_or_none()
        if row is None:
            raise resource_not_found_error()
        lease = cast(LocalWorkerLease, row[0])
        job = cast(LocalWorkerJob, row[1])
        if lease.state == LocalWorkerLeaseState.ACTIVE:
            lease.state = LocalWorkerLeaseState.REVOKED
            lease.revoked_at = utc_now()
            job.updated_at = lease.revoked_at
            if job.state not in {LocalWorkerJobState.COMPLETED, LocalWorkerJobState.FAILED}:
                job.state = LocalWorkerJobState.FAILED
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="knowledge.local_worker_lease_revoked",
                    result="success",
                    actor_id=context.user.id,
                    workspace_id=job.workspace_id,
                    target_type="local_worker_job",
                    target_id=job.id,
                    metadata={"lease_id": str(lease.id)},
                )
            )
        return lease

    async def checkpoint(
        self,
        db: AsyncSession,
        payload: LocalWorkerCheckpointRequest,
        token: str,
        *,
        job_id: UUID,
        request_id: str,
    ) -> LocalWorkerCheckpoint:
        lease, job = await self._validate_worker_scope(
            db,
            payload.lease_id,
            token,
            job_id=job_id,
            workspace_id=payload.workspace_id,
            space_id=payload.space_id,
            input_sha256=payload.input_sha256,
            allow_completed=False,
        )
        previous = await db.scalar(
            select(LocalWorkerCheckpoint)
            .where(LocalWorkerCheckpoint.job_id == job.id)
            .with_for_update()
        )
        if previous is not None:
            previous_stage = LocalWorkerStage(previous.stage)
            if _STAGE_ORDER[payload.stage] < _STAGE_ORDER[previous_stage]:
                raise local_worker_state_conflict_error()
            if previous_stage is LocalWorkerStage.UPLOADED:
                if previous.output_sha256 != payload.output_sha256:
                    raise local_worker_state_conflict_error()
                return previous
            if _STAGE_ORDER[payload.stage] == _STAGE_ORDER[previous_stage]:
                return previous
            previous.lease_id = lease.id
            previous.stage = payload.stage
            previous.output_sha256 = payload.output_sha256
            previous.updated_at = utc_now()
            checkpoint = previous
        else:
            checkpoint = LocalWorkerCheckpoint(
                id=UUID(int=secrets.randbits(128)),
                job_id=job.id,
                lease_id=lease.id,
                workspace_id=job.workspace_id,
                space_id=job.space_id,
                input_sha256=job.input_sha256,
                stage=payload.stage,
                output_sha256=payload.output_sha256,
                updated_at=utc_now(),
            )
            db.add(checkpoint)
        job.state = {
            LocalWorkerStage.CLAIMED: LocalWorkerJobState.QUEUED,
            LocalWorkerStage.RUNNING: LocalWorkerJobState.RUNNING,
            LocalWorkerStage.UPLOADED: LocalWorkerJobState.UPLOADED,
        }[payload.stage]
        job.updated_at = checkpoint.updated_at
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="knowledge.local_worker_checkpoint_recorded",
                result="success",
                workspace_id=job.workspace_id,
                target_type="local_worker_job",
                target_id=job.id,
                metadata={"stage": payload.stage.value},
            )
        )
        return checkpoint

    async def submit_result(
        self,
        db: AsyncSession,
        payload: LocalWorkerResultRequest,
        token: str,
        *,
        job_id: UUID,
        request_id: str,
    ) -> tuple[LocalWorkerResultReceipt, bool]:
        lease, job = await self._validate_worker_scope(
            db,
            payload.lease_id,
            token,
            job_id=job_id,
            workspace_id=payload.workspace_id,
            space_id=payload.space_id,
            input_sha256=payload.input_sha256,
            allow_completed=True,
        )
        payload_sha256 = _payload_digest(job.id, job.input_sha256, payload.output_sha256)
        receipt = await db.scalar(
            select(LocalWorkerResultReceipt)
            .where(
                LocalWorkerResultReceipt.job_id == job.id,
                LocalWorkerResultReceipt.workspace_id == job.workspace_id,
                LocalWorkerResultReceipt.idempotency_key == payload.idempotency_key,
            )
            .with_for_update()
        )
        if receipt is not None:
            if receipt.payload_sha256 != payload_sha256 or receipt.lease_id != lease.id:
                raise local_worker_idempotency_conflict_error()
            return receipt, True
        if lease.state != LocalWorkerLeaseState.ACTIVE:
            raise local_worker_state_conflict_error()
        checkpoint = await db.scalar(
            select(LocalWorkerCheckpoint)
            .where(LocalWorkerCheckpoint.job_id == job.id)
            .with_for_update()
        )
        if (
            checkpoint is None
            or checkpoint.stage != LocalWorkerStage.UPLOADED
            or checkpoint.output_sha256 != payload.output_sha256
        ):
            raise local_worker_state_conflict_error()
        accepted_at = utc_now()
        receipt = LocalWorkerResultReceipt(
            id=UUID(int=secrets.randbits(128)),
            job_id=job.id,
            lease_id=lease.id,
            workspace_id=job.workspace_id,
            space_id=job.space_id,
            idempotency_key=payload.idempotency_key,
            input_sha256=job.input_sha256,
            output_sha256=payload.output_sha256,
            payload_sha256=payload_sha256,
            accepted_at=accepted_at,
        )
        db.add(receipt)
        checkpoint_id = checkpoint.id
        await db.flush()
        await db.delete(checkpoint)
        lease.state = LocalWorkerLeaseState.COMPLETED
        lease.completed_at = accepted_at
        job.state = LocalWorkerJobState.COMPLETED
        job.completed_at = accepted_at
        job.updated_at = accepted_at
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="knowledge.local_worker_result_accepted",
                result="success",
                workspace_id=job.workspace_id,
                target_type="local_worker_job",
                target_id=job.id,
                metadata={"checkpoint_cleared": str(checkpoint_id)},
            )
        )
        await db.flush()
        return receipt, False

    async def recovery(
        self,
        db: AsyncSession,
        context: AuthContext,
        job_id: UUID,
    ) -> tuple[LocalWorkerJob, LocalWorkerCheckpoint | None]:
        job = await self._authorized_job(db, context, job_id, for_update=False)
        checkpoint = await db.scalar(
            select(LocalWorkerCheckpoint).where(LocalWorkerCheckpoint.job_id == job.id)
        )
        return job, checkpoint

    async def _validate_worker_scope(
        self,
        db: AsyncSession,
        lease_id: UUID,
        token: str,
        *,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        allow_completed: bool,
    ) -> tuple[LocalWorkerLease, LocalWorkerJob]:
        lease = await db.scalar(
            select(LocalWorkerLease).where(LocalWorkerLease.id == lease_id).with_for_update()
        )
        if lease is None or not secrets.compare_digest(lease.token_sha256, _digest(token)):
            raise local_worker_token_invalid_error()
        now = utc_now()
        if lease.state == LocalWorkerLeaseState.REVOKED:
            raise local_worker_token_invalid_error()
        if lease.state == LocalWorkerLeaseState.EXPIRED:
            raise local_worker_lease_expired_error()
        if lease.state == LocalWorkerLeaseState.COMPLETED and not allow_completed:
            raise local_worker_state_conflict_error()
        if lease.state == LocalWorkerLeaseState.ACTIVE and lease.expires_at <= now:
            lease.state = LocalWorkerLeaseState.EXPIRED
            raise local_worker_lease_expired_error()
        if (
            lease.job_id != job_id
            or lease.workspace_id != workspace_id
            or lease.space_id != space_id
        ):
            raise local_worker_scope_conflict_error()
        job = await db.scalar(
            select(LocalWorkerJob)
            .where(
                LocalWorkerJob.id == job_id,
                LocalWorkerJob.workspace_id == workspace_id,
                LocalWorkerJob.space_id == space_id,
                LocalWorkerJob.input_sha256 == input_sha256,
            )
            .with_for_update()
        )
        if job is None:
            raise local_worker_scope_conflict_error()
        return lease, job

    async def _authorized_job(
        self,
        db: AsyncSession,
        context: AuthContext,
        job_id: UUID,
        *,
        for_update: bool,
    ) -> LocalWorkerJob:
        statement = (
            select(LocalWorkerJob)
            .join(
                Space,
                (Space.id == LocalWorkerJob.space_id)
                & (Space.workspace_id == LocalWorkerJob.workspace_id),
            )
            .join(Workspace, Workspace.id == LocalWorkerJob.workspace_id)
            .join(
                WorkspaceMembership,
                (WorkspaceMembership.workspace_id == LocalWorkerJob.workspace_id)
                & (WorkspaceMembership.user_id == context.user.id),
            )
            .where(
                LocalWorkerJob.id == job_id,
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
                WorkspaceMembership.status == "active",
                Space.status == "active",
                Space.deleted_at.is_(None),
                Space.visibility == "private",
                or_(
                    LocalWorkerJob.created_by == context.user.id,
                    WorkspaceMembership.role.in_([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]),
                ),
            )
        )
        if for_update:
            statement = statement.with_for_update()
        job = await db.scalar(statement)
        if job is None:
            raise resource_not_found_error()
        return job

    async def _resolve_private_owner_scope(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
    ) -> None:
        row = (
            await db.execute(
                select(Space.id)
                .join(Workspace, Workspace.id == Space.workspace_id)
                .join(
                    WorkspaceMembership,
                    WorkspaceMembership.workspace_id == Workspace.id,
                )
                .where(
                    Space.id == space_id,
                    Space.workspace_id == workspace_id,
                    Space.visibility == "private",
                    Space.owner_user_id == context.user.id,
                    Space.status == "active",
                    Space.deleted_at.is_(None),
                    Workspace.status == "active",
                    Workspace.deleted_at.is_(None),
                    WorkspaceMembership.user_id == context.user.id,
                    WorkspaceMembership.status == "active",
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if row is None:
            raise resource_not_found_error()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _payload_digest(job_id: UUID, input_sha256: str, output_sha256: str) -> str:
    return _digest(f"{job_id}:{input_sha256}:{output_sha256}")
