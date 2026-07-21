from typing import Annotated

from fastapi import Depends

from logion_api.content.service import ContentService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_content_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> ContentService:
    return ContentService(settings, workspaces)


ContentServiceDependency = Annotated[ContentService, Depends(get_content_service)]
