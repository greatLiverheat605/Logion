from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.planning.service import PlanningService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_planning_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> PlanningService:
    return PlanningService(settings, workspaces)


PlanningServiceDependency = Annotated[PlanningService, Depends(get_planning_service)]
