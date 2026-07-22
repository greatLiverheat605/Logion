from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_portability_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> PortabilityService:
    return PortabilityService(settings, workspaces)


PortabilityServiceDependency = Annotated[PortabilityService, Depends(get_portability_service)]
