from typing import Annotated

from fastapi import Depends

from logion_api.workspaces.service import WorkspaceService


def get_workspace_service() -> WorkspaceService:
    return WorkspaceService()


WorkspaceServiceDependency = Annotated[WorkspaceService, Depends(get_workspace_service)]
