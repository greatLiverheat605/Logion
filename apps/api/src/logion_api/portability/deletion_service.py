from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.models import AIOutputDraft, AIRun, AIRunCandidate
from logion_api.config import Settings
from logion_api.db import session_factory, utc_now
from logion_api.engagement.models import CalendarFeed, Notification, NotificationPreference
from logion_api.errors import APIError
from logion_api.exam.models import Exam
from logion_api.execution.models import StudySession
from logion_api.growth.models import ShareSnapshot
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import (
    AuditEvent,
    AuthSession,
    Device,
    EmailOutbox,
    IdentityActionToken,
    MfaChallenge,
    PasskeyCredential,
    PasswordCredential,
    RecoveryCode,
    RefreshToken,
    TotpCredential,
    User,
    WebAuthnChallenge,
)
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext
from logion_api.memory.models import (
    AuditReview,
    ErrorPattern,
    MasteryRecord,
    QuizAttempt,
    ReviewSchedule,
)
from logion_api.portability.models import (
    AccountDeletionRequest,
    DataExportJob,
    DataImportPreview,
)
from logion_api.research.models import PaperRecord, ResearchQuestion
from logion_api.self_study.models import InboxItem, LearningTrack
from logion_api.workspaces.models import (
    Space,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)

POLICY_VERSION = "account-deletion-v1"


class AccountDeletionService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._security = IdentitySecurity(settings.secret_key.get_secret_value())

    async def request(
        self, db: AsyncSession, context: AuthContext, request_id: str
    ) -> AccountDeletionRequest:
        user = await db.scalar(select(User).where(User.id == context.user.id).with_for_update())
        if user is None or user.status != "active":
            raise self._not_found()
        owned = list(
            (
                await db.scalars(
                    select(WorkspaceMembership).where(
                        WorkspaceMembership.user_id == user.id,
                        WorkspaceMembership.role == "owner",
                        WorkspaceMembership.status == "active",
                    )
                )
            ).all()
        )
        deletable_workspace_ids: list[UUID] = []
        blocked_workspace_ids: list[UUID] = []
        for membership in owned:
            others = int(
                await db.scalar(
                    select(func.count(WorkspaceMembership.id)).where(
                        WorkspaceMembership.workspace_id == membership.workspace_id,
                        WorkspaceMembership.user_id != user.id,
                        WorkspaceMembership.status == "active",
                    )
                )
                or 0
            )
            (blocked_workspace_ids if others else deletable_workspace_ids).append(
                membership.workspace_id
            )
        if blocked_workspace_ids:
            raise APIError(
                code="ACCOUNT_DELETION_OWNERSHIP_BLOCKED",
                message="Transfer ownership of shared workspaces before deleting the account.",
                status_code=409,
            )
        now = utc_now()
        row = await db.scalar(
            select(AccountDeletionRequest)
            .where(AccountDeletionRequest.user_id == user.id)
            .with_for_update()
        )
        if row is None:
            row = AccountDeletionRequest(
                user_id=user.id,
                owned_workspace_ids=[str(value) for value in deletable_workspace_ids],
                policy_version=POLICY_VERSION,
                delete_after=now + timedelta(days=self._settings.account_deletion_grace_days),
            )
            db.add(row)
        else:
            row.status = "pending"
            row.owned_workspace_ids = [str(value) for value in deletable_workspace_ids]
            row.policy_version = POLICY_VERSION
            row.requested_at = now
            row.delete_after = now + timedelta(days=self._settings.account_deletion_grace_days)
            row.cancelled_at = None
            row.completed_at = None
            row.version += 1
        await db.flush()
        await self._revoke_access(db, user.id, now)
        user.status = "pending_deletion"
        user.version += 1
        user.updated_at = now
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="account.deletion_requested",
                result="pending",
                actor_id=user.id,
                target_type="account_deletion",
                target_id=row.id,
                metadata={
                    "policy_version": POLICY_VERSION,
                    "delete_after": row.delete_after.isoformat(),
                    "owned_workspace_count": len(deletable_workspace_ids),
                },
            )
        )
        await db.flush()
        return row

    async def get_pending(self, db: AsyncSession, context: AuthContext) -> AccountDeletionRequest:
        row = await db.scalar(
            select(AccountDeletionRequest).where(
                AccountDeletionRequest.user_id == context.user.id,
                AccountDeletionRequest.status == "pending",
            )
        )
        if row is None:
            raise self._not_found()
        return row

    async def cancel(
        self,
        db: AsyncSession,
        context: AuthContext,
        expected_version: int,
        request_id: str,
    ) -> AccountDeletionRequest:
        user = await db.scalar(select(User).where(User.id == context.user.id).with_for_update())
        row = await db.scalar(
            select(AccountDeletionRequest)
            .where(
                AccountDeletionRequest.user_id == context.user.id,
                AccountDeletionRequest.status == "pending",
            )
            .with_for_update()
        )
        if user is None or user.status != "pending_deletion" or row is None:
            raise self._not_found()
        if row.version != expected_version:
            raise APIError(
                code="VERSION_CONFLICT",
                message="The deletion request changed. Refresh before retrying.",
                status_code=409,
            )
        if row.delete_after <= utc_now():
            raise APIError(
                code="ACCOUNT_DELETION_DUE",
                message="Deletion processing has started.",
                status_code=409,
            )
        now = utc_now()
        row.status = "cancelled"
        row.cancelled_at = now
        row.version += 1
        user.status = "active"
        user.updated_at = now
        user.version += 1
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="account.deletion_cancelled",
                result="success",
                actor_id=user.id,
                target_type="account_deletion",
                target_id=row.id,
                metadata={"policy_version": row.policy_version},
            )
        )
        await db.flush()
        return row

    async def execute_next(self) -> bool:
        async with session_factory() as db:
            row = await db.scalar(
                select(AccountDeletionRequest)
                .where(
                    AccountDeletionRequest.status == "pending",
                    AccountDeletionRequest.delete_after <= utc_now(),
                )
                .order_by(AccountDeletionRequest.delete_after, AccountDeletionRequest.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if row is None:
                return False
            await self._physical_cleanup(db, row)
            await db.commit()
            return True

    async def _revoke_access(self, db: AsyncSession, user_id: UUID, now: datetime) -> None:
        session_ids = select(AuthSession.id).where(AuthSession.user_id == user_id)
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.session_id.in_(session_ids), RefreshToken.status == "active")
            .values(status="revoked", used_at=now)
        )
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
            .values(revoked_at=now, revoke_reason="account_deletion")
        )
        await db.execute(
            update(Device)
            .where(Device.user_id == user_id, Device.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await db.execute(
            update(ShareSnapshot)
            .where(ShareSnapshot.created_by == user_id, ShareSnapshot.status == "active")
            .values(
                status="revoked",
                revoked_by=user_id,
                revoked_at=now,
                version=ShareSnapshot.version + 1,
            )
        )
        await db.execute(
            update(CalendarFeed)
            .where(CalendarFeed.user_id == user_id, CalendarFeed.status == "active")
            .values(status="revoked", revoked_at=now, version=CalendarFeed.version + 1)
        )
        await db.execute(
            update(AIRun)
            .where(AIRun.requested_by == user_id, AIRun.status.in_(("queued", "running")))
            .values(cancel_requested_at=now)
        )

    async def _physical_cleanup(self, db: AsyncSession, request: AccountDeletionRequest) -> None:
        user = await db.scalar(select(User).where(User.id == request.user_id).with_for_update())
        if user is None or user.status != "pending_deletion" or request.status != "pending":
            return
        now = utc_now()
        for workspace_id in request.owned_workspace_ids:
            await db.execute(delete(Workspace).where(Workspace.id == UUID(workspace_id)))
        await db.execute(
            delete(Space).where(Space.owner_user_id == user.id, Space.visibility == "private")
        )
        for personal_model in (
            Exam,
            PaperRecord,
            ResearchQuestion,
            LearningTrack,
            InboxItem,
            MasteryRecord,
            ReviewSchedule,
            ErrorPattern,
            QuizAttempt,
            AuditReview,
        ):
            await db.execute(delete(personal_model).where(personal_model.user_id == user.id))
        await db.execute(delete(StudySession).where(StudySession.created_by == user.id))
        run_ids = select(AIRun.id).where(AIRun.requested_by == user.id)
        await db.execute(delete(AIOutputDraft).where(AIOutputDraft.run_id.in_(run_ids)))
        await db.execute(delete(AIRunCandidate).where(AIRunCandidate.run_id.in_(run_ids)))
        await db.execute(delete(AIRun).where(AIRun.id.in_(run_ids)))
        for scoped_model, field in (
            (Notification, Notification.recipient_user_id),
            (NotificationPreference, NotificationPreference.user_id),
            (CalendarFeed, CalendarFeed.user_id),
            (DataExportJob, DataExportJob.requested_by),
            (DataImportPreview, DataImportPreview.requested_by),
            (WorkspaceMembership, WorkspaceMembership.user_id),
        ):
            await db.execute(delete(scoped_model).where(field == user.id))
        await db.execute(
            delete(WorkspaceInvitation).where(
                WorkspaceInvitation.email_normalized == user.email_normalized
            )
        )
        for identity_model in (
            EmailOutbox,
            IdentityActionToken,
            MfaChallenge,
            PasskeyCredential,
            RecoveryCode,
            TotpCredential,
            WebAuthnChallenge,
            PasswordCredential,
            Device,
        ):
            await db.execute(delete(identity_model).where(identity_model.user_id == user.id))
        await db.execute(
            update(AuditEvent)
            .where(AuditEvent.actor_id == user.id)
            .values(actor_id=None, event_metadata={"retained": "account_deletion_policy"})
        )
        await db.execute(
            update(AuditEvent)
            .where(AuditEvent.target_type == "user", AuditEvent.target_id == user.id)
            .values(target_id=None)
        )
        pseudonym = self._security.privacy_hash(str(user.id)) or user.id.hex
        user.email = f"deleted+{pseudonym[:32]}@invalid.example"
        user.email_normalized = user.email
        user.email_verified_at = None
        user.status = "deleted"
        user.updated_at = now
        user.version += 1
        request.status = "completed"
        request.completed_at = now
        request.version += 1

    @staticmethod
    def _not_found() -> APIError:
        return APIError(
            code="ACCOUNT_DELETION_NOT_FOUND",
            message="Account deletion request not found.",
            status_code=404,
        )
