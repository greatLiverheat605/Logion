from typing import Annotated

from fastapi import Depends

from logion_api.content.dependencies import ContentServiceDependency
from logion_api.execution.dependencies import ExecutionServiceDependency
from logion_api.growth.service import GrowthService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.planning.dependencies import PlanningServiceDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_growth_service(
    settings: SettingsDependency,
    workspaces: WorkspaceServiceDependency,
    planning: PlanningServiceDependency,
    execution: ExecutionServiceDependency,
    content: ContentServiceDependency,
) -> GrowthService:
    return GrowthService(settings, workspaces, planning, execution, content)


GrowthServiceDependency = Annotated[GrowthService, Depends(get_growth_service)]
