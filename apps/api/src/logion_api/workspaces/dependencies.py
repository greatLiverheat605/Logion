from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency, get_security
from logion_api.workspaces.invitations import WorkspaceInvitationService
from logion_api.workspaces.service import WorkspaceService


def get_workspace_service(settings: SettingsDependency) -> WorkspaceService:
    return WorkspaceService(settings)


WorkspaceServiceDependency = Annotated[WorkspaceService, Depends(get_workspace_service)]


def get_workspace_invitation_service(
    settings: SettingsDependency,
) -> WorkspaceInvitationService:
    return WorkspaceInvitationService(settings, get_security())


WorkspaceInvitationServiceDependency = Annotated[
    WorkspaceInvitationService,
    Depends(get_workspace_invitation_service),
]
