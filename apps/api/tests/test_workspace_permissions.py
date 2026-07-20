import pytest
from logion_api.config import Settings
from logion_api.main import app
from logion_api.workspaces.permissions import (
    ROLE_PERMISSIONS,
    Permission,
    WorkspaceRole,
    role_has_permission,
)
from logion_api.workspaces.routes import _enforce_creation_rate_limit


class RecordingRateLimiter:
    def __init__(self) -> None:
        self.calls: list[dict[str, str | int]] = []

    async def enforce(self, *, scope: str, subject_hash: str, limit: int, window: int) -> None:
        self.calls.append(
            {
                "scope": scope,
                "subject_hash": subject_hash,
                "limit": limit,
                "window": window,
            }
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


@pytest.mark.asyncio
async def test_creation_rate_limits_use_independent_hashed_subjects() -> None:
    limiter = RecordingRateLimiter()
    settings = Settings()

    await _enforce_creation_rate_limit(
        limiter,
        scope="workspace_create",
        identity="user-a",
        limit=settings.workspace_create_limit_per_hour,
    )
    await _enforce_creation_rate_limit(
        limiter,
        scope="space_create",
        identity="workspace-a:user-a",
        limit=settings.space_create_limit_per_hour,
    )

    assert [call["scope"] for call in limiter.calls] == ["workspace_create", "space_create"]
    assert [call["limit"] for call in limiter.calls] == [10, 60]
    assert all(call["window"] == 3600 for call in limiter.calls)
    assert limiter.calls[0]["subject_hash"] != limiter.calls[1]["subject_hash"]
