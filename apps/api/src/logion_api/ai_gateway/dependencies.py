from typing import Annotated

from fastapi import Depends

from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
from logion_api.ai_gateway.service import AIProviderService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_ai_provider_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> AIProviderService:
    return AIProviderService(settings, workspaces)


AIProviderServiceDependency = Annotated[AIProviderService, Depends(get_ai_provider_service)]


def get_ai_discovery_adapter(settings: SettingsDependency) -> OpenAICompatibleDiscoveryAdapter:
    return OpenAICompatibleDiscoveryAdapter(
        max_response_bytes=settings.ai_provider_response_max_bytes,
        max_models=settings.ai_provider_discovery_model_limit,
    )


AIProviderDiscoveryAdapterDependency = Annotated[
    OpenAICompatibleDiscoveryAdapter, Depends(get_ai_discovery_adapter)
]
