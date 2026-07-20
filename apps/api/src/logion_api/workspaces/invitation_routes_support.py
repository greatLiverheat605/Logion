from logion_api.workspaces.schemas import WorkspaceResponse
from logion_api.workspaces.service import WorkspaceAccess


def workspace_response(access: WorkspaceAccess) -> WorkspaceResponse:
    return WorkspaceResponse.model_validate(
        {
            "id": access.workspace.id,
            "name": access.workspace.name,
            "status": access.workspace.status,
            "version": access.workspace.version,
            "role": access.membership.role,
            "membership_status": access.membership.status,
            "created_at": access.workspace.created_at,
            "updated_at": access.workspace.updated_at,
        }
    )
