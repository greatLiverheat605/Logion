from enum import StrEnum
from uuid import UUID

from logion_api.knowledge_space.errors import (
    operation_denied_error,
    resource_not_found_error,
    shared_writes_disabled_error,
)
from logion_api.workspaces.permissions import (
    Permission,
    SpaceVisibility,
    WorkspaceRole,
    role_has_permission,
)


class KnowledgeAction(StrEnum):
    READ = "read"
    WRITE = "write"
    ACCEPT = "accept"


SHARED_ACTION_PERMISSION = {
    KnowledgeAction.READ: Permission.SHARED_KNOWLEDGE_READ,
    KnowledgeAction.WRITE: Permission.SHARED_KNOWLEDGE_WRITE,
    KnowledgeAction.ACCEPT: Permission.SHARED_KNOWLEDGE_ACCEPT,
}


def authorize_space_policy(
    *,
    role: WorkspaceRole,
    visibility: SpaceVisibility,
    caller_user_id: UUID,
    owner_user_id: UUID,
    action: KnowledgeAction,
    shared_writes_enabled: bool,
) -> None:
    """Apply policy only after active membership and scoped Space resolution.

    V20-08 remains responsible for the scoped database query and for repeating
    this policy while rows are locked. This pure policy keeps private denials
    non-enumerating and the Shared permission/feature order deterministic.
    """

    if visibility is SpaceVisibility.PRIVATE:
        if caller_user_id != owner_user_id:
            raise resource_not_found_error()
        return

    permission = SHARED_ACTION_PERMISSION[action]
    if not role_has_permission(role, permission):
        if action is KnowledgeAction.READ:
            raise resource_not_found_error()
        raise operation_denied_error()
    if action is not KnowledgeAction.READ and not shared_writes_enabled:
        raise shared_writes_disabled_error()
