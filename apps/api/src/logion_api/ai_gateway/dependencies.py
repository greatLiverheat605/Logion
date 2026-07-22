from typing import Annotated

from fastapi import Depends

from logion_api.ai_gateway.service import AIProviderService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_ai_provider_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> AIProviderService:
    return AIProviderService(settings, workspaces)


AIProviderServiceDependency = Annotated[AIProviderService, Depends(get_ai_provider_service)]
