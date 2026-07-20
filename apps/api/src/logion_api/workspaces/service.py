from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent, User
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import (
    Permission,
    SpaceVisibility,
    WorkspaceRole,
    role_can_manage_membership,
    role_has_permission,
)


@dataclass(frozen=True)
class WorkspaceAccess:
    workspace: Workspace
    membership: WorkspaceMembership


@dataclass(frozen=True)
class WorkspaceMember:
    membership: WorkspaceMembership
    user: User


class WorkspaceService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def provision_personal_workspace(
        self,
        db: AsyncSession,
        user_id: UUID,
        *,
        request_id: str,
    ) -> WorkspaceAccess:
        return await self._create_workspace(
            db,
            user_id,
            name="Personal workspace",
            private_space_name="Private",
            request_id=request_id,
            event_type="workspace.personal_provisioned",
        )

    async def create_workspace(
        self,
        db: AsyncSession,
        context: AuthContext,
        name: str,
        *,
        request_id: str,
    ) -> WorkspaceAccess:
        await db.scalar(
            select(User.id).where(User.id == context.user.id).with_for_update(of=User)
        )
        owned_count = int(
            await db.scalar(
                select(func.count(WorkspaceMembership.id))
                .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
                .where(
                    WorkspaceMembership.user_id == context.user.id,
                    WorkspaceMembership.role == WorkspaceRole.OWNER.value,
                    WorkspaceMembership.status == "active",
                    Workspace.status == "active",
                    Workspace.deleted_at.is_(None),
                )
            )
            or 0
        )
        if owned_count >= self._settings.workspace_owned_quota:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="workspace.quota_denied",
                    result="denied",
                    actor_id=context.user.id,
                    target_type="workspace",
                    metadata={
                        "quota": self._settings.workspace_owned_quota,
                        "current": owned_count,
                    },
                )
            )
            raise self._quota_error("The account has reached its Workspace limit.")
        return await self._create_workspace(
            db,
            context.user.id,
            name=name.strip(),
            private_space_name="Private",
            request_id=request_id,
            event_type="workspace.created",
        )

    async def _create_workspace(
        self,
        db: AsyncSession,
        user_id: UUID,
        *,
        name: str,
        private_space_name: str,
        request_id: str,
        event_type: str,
    ) -> WorkspaceAccess:
        now = datetime.now(UTC)
        workspace = Workspace(name=name, created_by=user_id)
        db.add(workspace)
        await db.flush()
        membership = WorkspaceMembership(
            workspace_id=workspace.id,
            user_id=user_id,
            role=WorkspaceRole.OWNER.value,
            status="active",
            joined_at=now,
        )
        private_space = Space(
            workspace_id=workspace.id,
            owner_user_id=user_id,
            name=private_space_name,
            visibility="private",
            created_by=user_id,
            updated_by=user_id,
        )
        db.add_all((membership, private_space))
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=event_type,
                result="success",
                actor_id=user_id,
                workspace_id=workspace.id,
                target_type="workspace",
                target_id=workspace.id,
            )
        )
        return WorkspaceAccess(workspace=workspace, membership=membership)

    async def list_workspaces(
        self,
        db: AsyncSession,
        context: AuthContext,
    ) -> list[WorkspaceAccess]:
        result = await db.execute(
            select(Workspace, WorkspaceMembership)
            .join(
                WorkspaceMembership,
                WorkspaceMembership.workspace_id == Workspace.id,
            )
            .where(
                WorkspaceMembership.user_id == context.user.id,
                WorkspaceMembership.status == "active",
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
            )
            .order_by(Workspace.created_at.asc())
        )
        return [WorkspaceAccess(workspace=row[0], membership=row[1]) for row in result.all()]

    async def resolve_workspace(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        *,
        request_id: str,
        permission: Permission = Permission.WORKSPACE_READ,
    ) -> WorkspaceAccess:
        result = await db.execute(
            select(Workspace, WorkspaceMembership)
            .join(
                WorkspaceMembership,
                WorkspaceMembership.workspace_id == Workspace.id,
            )
            .where(
                Workspace.id == workspace_id,
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == context.user.id,
                WorkspaceMembership.status == "active",
                Workspace.status == "active",
                Workspace.deleted_at.is_(None),
            )
        )
        row = result.one_or_none()
        if row is None:
            db.add(self._denied_audit(request_id, context.user.id, workspace_id, "workspace"))
            raise self._not_found_error()
        access = WorkspaceAccess(workspace=row[0], membership=row[1])
        self.require_permission(
            db,
            access,
            context.user.id,
            permission,
            request_id=request_id,
        )
        return access

    def require_permission(
        self,
        db: AsyncSession,
        access: WorkspaceAccess,
        actor_id: UUID,
        permission: Permission,
        *,
        request_id: str,
    ) -> None:
        role = WorkspaceRole(access.membership.role)
        if role_has_permission(role, permission):
            return
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="authorization.permission_denied",
                result="denied",
                actor_id=actor_id,
                workspace_id=access.workspace.id,
                target_type="workspace",
                target_id=access.workspace.id,
                metadata={"permission": permission.value, "role": role.value},
            )
        )
        raise APIError(
            code="AUTHZ_PERMISSION_DENIED",
            message="You do not have permission to perform this action.",
            status_code=403,
        )

    async def list_spaces(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        *,
        request_id: str,
    ) -> list[Space]:
        await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_READ,
        )
        spaces = await db.scalars(
            select(Space)
            .where(
                Space.workspace_id == workspace_id,
                Space.status == "active",
                Space.deleted_at.is_(None),
                or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
            )
            .order_by(Space.created_at.asc())
        )
        return list(spaces.all())

    async def resolve_space(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        *,
        request_id: str,
    ) -> Space:
        await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_READ,
        )
        space = await db.scalar(
            select(Space).where(
                Space.id == space_id,
                Space.workspace_id == workspace_id,
                Space.status == "active",
                Space.deleted_at.is_(None),
                or_(Space.visibility == "shared", Space.owner_user_id == context.user.id),
            )
        )
        if space is None:
            db.add(self._denied_audit(request_id, context.user.id, workspace_id, "space"))
            raise self._not_found_error()
        return space

    async def create_space(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        *,
        name: str,
        visibility: SpaceVisibility,
        request_id: str,
    ) -> Space:
        permission = (
            Permission.SPACE_CREATE_SHARED
            if visibility is SpaceVisibility.SHARED
            else Permission.SPACE_CREATE_PRIVATE
        )
        access = await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=permission,
        )
        await db.scalar(
            select(Workspace.id)
            .where(Workspace.id == access.workspace.id)
            .with_for_update(of=Workspace)
        )
        space_count = int(
            await db.scalar(
                select(func.count(Space.id)).where(
                    Space.workspace_id == access.workspace.id,
                    Space.deleted_at.is_(None),
                )
            )
            or 0
        )
        if space_count >= self._settings.space_per_workspace_quota:
            db.add(
                new_audit_event(
                    request_id=request_id,
                    event_type="space.quota_denied",
                    result="denied",
                    actor_id=context.user.id,
                    workspace_id=access.workspace.id,
                    target_type="space",
                    metadata={
                        "quota": self._settings.space_per_workspace_quota,
                        "current": space_count,
                    },
                )
            )
            raise self._quota_error("The Workspace has reached its Space limit.")
        space = Space(
            workspace_id=access.workspace.id,
            owner_user_id=context.user.id,
            name=name.strip(),
            visibility=visibility.value,
            created_by=context.user.id,
            updated_by=context.user.id,
        )
        db.add(space)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="space.created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="space",
                target_id=space.id,
                metadata={"visibility": visibility.value},
            )
        )
        return space

    async def list_members(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        *,
        request_id: str,
    ) -> list[WorkspaceMember]:
        await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_MANAGE_MEMBERS,
        )
        result = await db.execute(
            select(WorkspaceMembership, User)
            .join(User, User.id == WorkspaceMembership.user_id)
            .where(WorkspaceMembership.workspace_id == workspace_id)
            .order_by(WorkspaceMembership.created_at.asc(), WorkspaceMembership.id.asc())
        )
        return [WorkspaceMember(membership=row[0], user=row[1]) for row in result.all()]

    async def update_membership(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        membership_id: UUID,
        *,
        expected_version: int,
        role: WorkspaceRole | None,
        status: str | None,
        request_id: str,
    ) -> WorkspaceMember:
        access = await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_MANAGE_MEMBERS,
        )
        await db.scalar(
            select(Workspace.id)
            .where(Workspace.id == workspace_id)
            .with_for_update(of=Workspace)
        )
        access = await self.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.WORKSPACE_MANAGE_MEMBERS,
        )
        result = await db.execute(
            select(WorkspaceMembership, User)
            .join(User, User.id == WorkspaceMembership.user_id)
            .where(
                WorkspaceMembership.id == membership_id,
                WorkspaceMembership.workspace_id == workspace_id,
            )
            .with_for_update(of=WorkspaceMembership)
        )
        row = result.one_or_none()
        if row is None:
            raise self._not_found_error()
        membership: WorkspaceMembership = row[0]
        user: User = row[1]
        actor_role = WorkspaceRole(access.membership.role)
        target_role = WorkspaceRole(membership.role)
        desired_role = role or target_role

        if membership.user_id == context.user.id:
            self._membership_denied_audit(
                db, context.user.id, workspace_id, membership.id, request_id, "self_change"
            )
            raise self._membership_denied()
        if not role_can_manage_membership(actor_role, target_role, desired_role):
            self._membership_denied_audit(
                db, context.user.id, workspace_id, membership.id, request_id, "role_hierarchy"
            )
            if target_role is WorkspaceRole.OWNER:
                raise APIError(
                    code="MEMBERSHIP_OWNER_PROTECTED",
                    message="Owner membership requires the ownership transfer workflow.",
                    status_code=409,
                )
            raise self._membership_denied()
        if membership.version != expected_version:
            raise APIError(
                code="MEMBERSHIP_VERSION_CONFLICT",
                message="The membership changed. Refresh and try again.",
                status_code=409,
            )
        if (
            membership.status == "revoked"
            and status == "active"
            and actor_role is not WorkspaceRole.OWNER
        ):
            self._membership_denied_audit(
                db,
                context.user.id,
                workspace_id,
                membership.id,
                request_id,
                "revoked_restore_requires_owner",
            )
            raise self._membership_denied()
        if membership.status == "revoked" and status not in {None, "active"}:
            raise APIError(
                code="MEMBERSHIP_TRANSITION_INVALID",
                message="A revoked membership can only be restored by an Owner.",
                status_code=409,
            )

        desired_status = status or membership.status
        if desired_role.value == membership.role and desired_status == membership.status:
            raise APIError(
                code="MEMBERSHIP_NO_CHANGE",
                message="The requested membership values are already active.",
                status_code=409,
            )
        before_role = membership.role
        before_status = membership.status
        now = datetime.now(UTC)
        membership.role = desired_role.value
        membership.status = desired_status
        membership.version += 1
        membership.updated_at = now
        if desired_status == "revoked" and before_status != "revoked":
            membership.revoked_at = now
        elif desired_status != "revoked":
            membership.revoked_at = None
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.membership_updated",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="workspace_membership",
                target_id=membership.id,
                metadata={
                    "role_before": before_role,
                    "role_after": membership.role,
                    "status_before": before_status,
                    "status_after": membership.status,
                },
            )
        )
        return WorkspaceMember(membership=membership, user=user)

    @staticmethod
    def _membership_denied() -> APIError:
        return APIError(
            code="AUTHZ_MEMBER_MANAGEMENT_DENIED",
            message="You cannot manage this Workspace membership.",
            status_code=403,
        )

    @staticmethod
    def _membership_denied_audit(
        db: AsyncSession,
        actor_id: UUID,
        workspace_id: UUID,
        membership_id: UUID,
        request_id: str,
        reason: str,
    ) -> None:
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="workspace.membership_update_denied",
                result="denied",
                actor_id=actor_id,
                workspace_id=workspace_id,
                target_type="workspace_membership",
                target_id=membership_id,
                metadata={"reason": reason},
            )
        )

    @staticmethod
    def _denied_audit(
        request_id: str,
        actor_id: UUID,
        workspace_id: UUID,
        target_type: str,
    ) -> AuditEvent:
        return new_audit_event(
            request_id=request_id,
            event_type="authorization.scope_denied",
            result="denied",
            actor_id=actor_id,
            workspace_id=workspace_id,
            target_type=target_type,
        )

    @staticmethod
    def _not_found_error() -> APIError:
        return APIError(
            code="RESOURCE_NOT_FOUND",
            message="The requested resource was not found.",
            status_code=404,
        )

    @staticmethod
    def _quota_error(message: str) -> APIError:
        return APIError(
            code="RESOURCE_QUOTA_EXCEEDED",
            message=message,
            status_code=409,
        )
