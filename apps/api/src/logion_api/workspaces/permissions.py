from enum import StrEnum


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    CONTRIBUTOR = "contributor"
    REVIEWER = "reviewer"
    VIEWER = "viewer"


class WorkspaceStatus(StrEnum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"


class MembershipStatus(StrEnum):
    INVITED = "invited"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    REVOKED = "revoked"


class SpaceVisibility(StrEnum):
    PRIVATE = "private"
    SHARED = "shared"


class SpaceStatus(StrEnum):
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


class Permission(StrEnum):
    WORKSPACE_READ = "workspace.read"
    WORKSPACE_MANAGE_SECURITY = "workspace.manage_security"
    WORKSPACE_MANAGE_MEMBERS = "workspace.manage_members"
    SPACE_CREATE_PRIVATE = "space.create_private"
    SPACE_CREATE_SHARED = "space.create_shared"
    SPACE_DELETE_SHARED = "space.delete_shared"
    SHARED_CONTENT_READ = "shared_content.read"
    SHARED_PLAN_WRITE = "shared_plan.write"
    EVIDENCE_SUBMIT = "evidence.submit"
    REVIEW_WRITE = "review.write"
    SHARE_CREATE = "share.create"


ROLE_PERMISSIONS: dict[WorkspaceRole, frozenset[Permission]] = {
    WorkspaceRole.OWNER: frozenset(Permission),
    WorkspaceRole.ADMIN: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.WORKSPACE_MANAGE_MEMBERS,
            Permission.SPACE_CREATE_PRIVATE,
            Permission.SPACE_CREATE_SHARED,
            Permission.SPACE_DELETE_SHARED,
            Permission.SHARED_CONTENT_READ,
            Permission.SHARED_PLAN_WRITE,
            Permission.EVIDENCE_SUBMIT,
            Permission.REVIEW_WRITE,
            Permission.SHARE_CREATE,
        }
    ),
    WorkspaceRole.EDITOR: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SPACE_CREATE_PRIVATE,
            Permission.SPACE_CREATE_SHARED,
            Permission.SHARED_CONTENT_READ,
            Permission.SHARED_PLAN_WRITE,
            Permission.EVIDENCE_SUBMIT,
            Permission.REVIEW_WRITE,
            Permission.SHARE_CREATE,
        }
    ),
    WorkspaceRole.CONTRIBUTOR: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SPACE_CREATE_PRIVATE,
            Permission.SHARED_CONTENT_READ,
            Permission.EVIDENCE_SUBMIT,
        }
    ),
    WorkspaceRole.REVIEWER: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SPACE_CREATE_PRIVATE,
            Permission.SHARED_CONTENT_READ,
            Permission.REVIEW_WRITE,
        }
    ),
    WorkspaceRole.VIEWER: frozenset(
        {
            Permission.WORKSPACE_READ,
            Permission.SPACE_CREATE_PRIVATE,
            Permission.SHARED_CONTENT_READ,
        }
    ),
}


def role_has_permission(role: WorkspaceRole, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS[role]
