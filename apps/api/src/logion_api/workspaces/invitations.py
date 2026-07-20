import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import User
from logion_api.identity.security import IdentitySecurity
from logion_api.identity.service import AuthContext, normalize_email
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
    def __init__(self, settings: Settings, security: IdentitySecurity) -> None:
        self._settings = settings
        self._security = security
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
        pending = await db.scalar(
            select(WorkspaceInvitation.id).where(
                WorkspaceInvitation.workspace_id == workspace_id,
                WorkspaceInvitation.email_normalized == normalized,
                WorkspaceInvitation.status == "pending",
                WorkspaceInvitation.expires_at > datetime.now(UTC),
            )
        )
        if pending is not None:
            raise self._conflict("A pending invitation already exists for this account.")

        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
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
