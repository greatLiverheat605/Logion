from typing import Annotated

from fastapi import Depends

from logion_api.engagement.service import EngagementService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_engagement_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> EngagementService:
    return EngagementService(settings, workspaces)


EngagementServiceDependency = Annotated[EngagementService, Depends(get_engagement_service)]
