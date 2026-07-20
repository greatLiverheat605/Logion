from logion_api.main import app
from logion_api.workspaces.permissions import (
    ROLE_PERMISSIONS,
    Permission,
    WorkspaceRole,
    role_has_permission,
)


def test_workspace_roles_are_canonical_and_do_not_include_legacy_member() -> None:
    assert {role.value for role in WorkspaceRole} == {
        "owner",
        "admin",
        "editor",
        "contributor",
        "reviewer",
        "viewer",
    }
    assert "member" not in {role.value for role in ROLE_PERMISSIONS}


def test_named_permission_matrix_matches_privacy_baseline() -> None:
    assert ROLE_PERMISSIONS[WorkspaceRole.OWNER] == frozenset(Permission)
    assert not role_has_permission(
        WorkspaceRole.ADMIN,
        Permission.WORKSPACE_MANAGE_SECURITY,
    )
    assert role_has_permission(WorkspaceRole.ADMIN, Permission.WORKSPACE_MANAGE_MEMBERS)
    assert role_has_permission(WorkspaceRole.EDITOR, Permission.SPACE_CREATE_SHARED)
    assert not role_has_permission(
        WorkspaceRole.CONTRIBUTOR,
        Permission.SPACE_CREATE_SHARED,
    )
    assert role_has_permission(WorkspaceRole.CONTRIBUTOR, Permission.EVIDENCE_SUBMIT)
    assert role_has_permission(WorkspaceRole.REVIEWER, Permission.REVIEW_WRITE)
    assert not role_has_permission(WorkspaceRole.REVIEWER, Permission.EVIDENCE_SUBMIT)
    assert role_has_permission(WorkspaceRole.VIEWER, Permission.SHARED_CONTENT_READ)
    assert not role_has_permission(WorkspaceRole.VIEWER, Permission.SHARED_PLAN_WRITE)
    assert all(role_has_permission(role, Permission.SPACE_CREATE_PRIVATE) for role in WorkspaceRole)


def test_openapi_exposes_only_canonical_workspace_roles() -> None:
    role_schema = app.openapi()["components"]["schemas"]["WorkspaceRole"]

    assert role_schema["enum"] == [
        "owner",
        "admin",
        "editor",
        "contributor",
        "reviewer",
        "viewer",
    ]
