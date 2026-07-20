from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import (
    Permission,
    SpaceVisibility,
    WorkspaceRole,
    role_has_permission,
)


@dataclass(frozen=True)
class WorkspaceAccess:
    workspace: Workspace
    membership: WorkspaceMembership


class WorkspaceService:
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
