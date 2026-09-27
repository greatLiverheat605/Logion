import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.email_verification import EmailDeliveryCipher
from logion_api.identity.models import EmailOutbox, User
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, normalize_email, require_verified_email
from logion_api.workspaces.models import (
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceAccess, WorkspaceService


@dataclass(frozen=True)
class IssuedWorkspaceInvitation:
    invitation: WorkspaceInvitation
    token: str


class WorkspaceInvitationService:
    _EMAIL_PURPOSE = "workspace_invitation"

    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security
        self._email_cipher = EmailDeliveryCipher(settings)
        self._workspaces = WorkspaceService(settings)

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        *,
        email: str,
        role: str,
        request_id: str,
    ) -> IssuedWorkspaceInvitation:
        access = await self._workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_MANAGE_MEMBERS,
        )
        await db.scalar(
            select(Workspace.id)
            .where(Workspace.id == access.workspace.id)
            .with_for_update(of=Workspace)
        )
        normalized = normalize_email(email)
        existing_user_id = await db.scalar(
            select(User.id).where(User.email_normalized == normalized)
        )
        if existing_user_id is not None:
            existing_membership = await db.scalar(
                select(WorkspaceMembership.id).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == existing_user_id,
                    WorkspaceMembership.status == "active",
                )
            )
            if existing_membership is not None:
                raise self._conflict("The account is already an active Workspace member.")
        now = datetime.now(UTC)
        pending = await db.scalar(
            select(WorkspaceInvitation)
            .where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.email_normalized == normalized,
                WorkspaceInvitation.status == "pending",
                WorkspaceInvitation.expires_at > now,
            )
            .with_for_update(of=WorkspaceInvitation)
        )
        if pending is not None:
            delivery_exists = await db.scalar(
                select(EmailOutbox.id)
                .where(EmailOutbox.workspace_invitation_id == pending.id)
                .limit(1)
            )
            if delivery_exists is not None:
                raise self._conflict("A pending invitation already exists for this account.")

            # Invitations created before email delivery support have only a token hash.
            # Rotate that unusable token before queueing the first delivery.
            token = secrets.token_urlsafe(32)
            pending.token_hash = self._token_hash(token)
            pending.role = role
            pending.version += 1
            pending.updated_at = now
            pending.expires_at = now + timedelta(days=self._settings.invitation_ttl_days)
            self._queue_delivery(
                db,
                invitation=pending,
                recipient=normalized,
                token=token,
                workspace_name=access.workspace.name,
            )
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="workspace.invitation_delivery_backfilled",
                    result="pending",
                    actor_id=context.user.id,
                    workspace_id=workspace_id,
                    target_type="workspace_invitation",
                    target_id=pending.id,
                    metadata={"role": role},
                )
            )
            return IssuedWorkspaceInvitation(invitation=pending, token=token)

        token = secrets.token_urlsafe(32)
        invitation = WorkspaceInvitation(
            workspace_id=workspace_id,
            email_normalized=normalized,
            role=role,
            token_hash=self._token_hash(token),
            invited_by=context.user.id,
            expires_at=now + timedelta(days=self._settings.invitation_ttl_days),
        )
        db.add(invitation)
        await db.flush()
        self._queue_delivery(
            db,
            invitation=invitation,
            recipient=normalized,
            token=token,
            workspace_name=access.workspace.name,
        )
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.invitation_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="workspace_invitation",
                target_id=invitation.id,
                metadata={"role": role},
            )
        )
        return IssuedWorkspaceInvitation(invitation=invitation, token=token)

    async def accept(
        self,
        db: AsyncSession,
        context: AuthContext,
        token: str,
        *,
        request_id: str,
    ) -> WorkspaceAccess:
        require_verified_email(context.user)
        invitation = await db.scalar(
            select(WorkspaceInvitation)
            .where(WorkspaceInvitation.token_hash == self._token_hash(token))
            .with_for_update(of=WorkspaceInvitation)
        )
        if invitation is None:
            raise self._invalid()
        now = datetime.now(UTC)
        if invitation.status != "pending":
            self._audit_denied(db, invitation, context.user.id, request_id, "not_pending")
            raise self._invalid()
        if invitation.expires_at <= now:
            invitation.status = "expired"
            invitation.updated_at = now
            invitation.version += 1
            await self._terminate_delivery(db, invitation.id, now)
            self._audit_denied(db, invitation, context.user.id, request_id, "expired")
            raise self._invalid()
        if invitation.email_normalized != context.user.email_normalized:
            self._audit_denied(db, invitation, context.user.id, request_id, "account_mismatch")
            raise self._invalid()

        workspace = await db.scalar(
            select(Workspace)
            .where(
                Workspace.id == invitation.workspace_id,
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
            )
            .with_for_update(of=Workspace)
        )
        if workspace is None:
            self._audit_denied(db, invitation, context.user.id, request_id, "workspace_inactive")
            raise self._invalid()

        membership = await db.scalar(
            select(WorkspaceMembership)
            .where(
                WorkspaceMembership.workspace_id == invitation.workspace_id,
                WorkspaceMembership.user_id == context.user.id,
            )
            .with_for_update(of=WorkspaceMembership)
        )
        if membership is not None:
            self._audit_denied(db, invitation, context.user.id, request_id, "membership_exists")
            raise self._conflict("A Workspace membership already exists for this account.")

        membership = WorkspaceMembership(
            workspace_id=invitation.workspace_id,
            user_id=context.user.id,
            role=invitation.role,
            status="active",
            joined_at=now,
        )
        db.add(membership)
        invitation.status = "accepted"
        invitation.accepted_by = context.user.id
        invitation.accepted_at = now
        invitation.updated_at = now
        invitation.version += 1
        await self._terminate_delivery(db, invitation.id, now)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.invitation_accepted",
                result="success",
                actor_id=context.user.id,
                workspace_id=invitation.workspace_id,
                target_type="workspace_invitation",
                target_id=invitation.id,
                metadata={"role": invitation.role},
            )
        )
        return WorkspaceAccess(workspace=workspace, membership=membership)

    async def revoke(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        invitation_id: UUID,
        *,
        request_id: str,
    ) -> WorkspaceInvitation:
        await self._workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_MANAGE_MEMBERS,
        )
        invitation = await db.scalar(
            select(WorkspaceInvitation)
            .where(
                WorkspaceInvitation.id == invitation_id,
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.status == "pending",
            )
            .with_for_update(of=WorkspaceInvitation)
        )
        if invitation is None:
            raise WorkspaceService._not_found_error()
        now = datetime.now(UTC)
        invitation.status = "revoked"
        invitation.revoked_by = context.user.id
        invitation.revoked_at = now
        invitation.updated_at = now
        invitation.version += 1
        await self._terminate_delivery(db, invitation.id, now)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.invitation_revoked",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="workspace_invitation",
                target_id=invitation.id,
            )
        )
        return invitation

    def _token_hash(self, token: str) -> str:
        return self._security.token_hash(f"workspace-invitation:{token}")

    def _queue_delivery(
        self,
        db: AsyncSession,
        *,
        invitation: WorkspaceInvitation,
        recipient: str,
        token: str,
        workspace_name: str,
    ) -> None:
        outbox_id = uuid7()
        encrypted = self._email_cipher.encrypt(
            outbox_id=outbox_id,
            user_id=invitation.invited_by,
            purpose=self._EMAIL_PURPOSE,
            payload={
                "recipient": recipient,
                "token": token,
                "workspace_name": workspace_name,
                "role": invitation.role,
            },
        )
        db.add(
            EmailOutbox(
                id=outbox_id,
                user_id=invitation.invited_by,
                action_token_id=None,
                workspace_invitation_id=invitation.id,
                purpose=self._EMAIL_PURPOSE,
                encryption_key_id=encrypted.key_id,
                payload_ciphertext=encrypted.ciphertext,
                payload_nonce=encrypted.nonce,
            )
        )

    @staticmethod
    async def _terminate_delivery(
        db: AsyncSession,
        invitation_id: UUID,
        now: datetime,
    ) -> None:
        await db.execute(
            update(EmailOutbox)
            .where(
                EmailOutbox.workspace_invitation_id == invitation_id,
                EmailOutbox.status.in_(("pending", "leased")),
            )
            .values(
                status="dead",
                payload_ciphertext=b"",
                payload_nonce=b"",
                lease_expires_at=None,
                terminal_at=now,
            )
        )

    @staticmethod
    def _invalid() -> APIError:
        return APIError(
            code="INVITATION_INVALID",
            message="The invitation is invalid or no longer available.",
            status_code=404,
        )

    @staticmethod
    def _conflict(message: str) -> APIError:
        return APIError(code="INVITATION_CONFLICT", message=message, status_code=409)

    @staticmethod
    def _audit_denied(
        db: AsyncSession,
        invitation: WorkspaceInvitation,
        actor_id: UUID,
        request_id: str,
        reason: str,
    ) -> None:
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.invitation_accept_denied",
                result="denied",
                actor_id=actor_id,
                workspace_id=invitation.workspace_id,
                target_type="workspace_invitation",
                target_id=invitation.id,
                metadata={"reason": reason},
            )
        )
