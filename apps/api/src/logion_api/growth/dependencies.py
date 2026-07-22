from typing import Annotated

from fastapi import Depends

from logion_api.growth.service import GrowthService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.planning.dependencies import PlanningServiceDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_growth_service(
    settings: SettingsDependency,
    workspaces: WorkspaceServiceDependency,
    planning: PlanningServiceDependency,
) -> GrowthService:
    return GrowthService(settings, workspaces, planning)


GrowthServiceDependency = Annotated[GrowthService, Depends(get_growth_service)]
