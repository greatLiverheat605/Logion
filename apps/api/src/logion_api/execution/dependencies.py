from typing import Annotated

from fastapi import Depends

from logion_api.execution.service import ExecutionService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_execution_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> ExecutionService:
    return ExecutionService(settings, workspaces)


ExecutionServiceDependency = Annotated[ExecutionService, Depends(get_execution_service)]
