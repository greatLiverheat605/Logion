from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.memory.service import MemoryService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_memory_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> MemoryService:
    return MemoryService(settings, workspaces)


MemoryServiceDependency = Annotated[MemoryService, Depends(get_memory_service)]
