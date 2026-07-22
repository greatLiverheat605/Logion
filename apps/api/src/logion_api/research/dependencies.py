from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.research.service import ResearchService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_research_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> ResearchService:
    return ResearchService(settings, workspaces)


ResearchServiceDependency = Annotated[ResearchService, Depends(get_research_service)]
