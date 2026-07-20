from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.service import WorkspaceService


def get_workspace_service(settings: SettingsDependency) -> WorkspaceService:
    return WorkspaceService(settings)


WorkspaceServiceDependency = Annotated[WorkspaceService, Depends(get_workspace_service)]
