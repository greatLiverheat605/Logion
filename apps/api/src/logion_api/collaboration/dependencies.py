from typing import Annotated

from fastapi import Depends

from logion_api.collaboration.service import CollaborationService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_collaboration(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> CollaborationService:
    return CollaborationService(settings, workspaces)


CollaborationServiceDependency = Annotated[CollaborationService, Depends(get_collaboration)]
