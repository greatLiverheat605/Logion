from typing import Annotated

from fastapi import Depends

from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
from logion_api.ai_gateway.routing_service import AIRoutingService
from logion_api.ai_gateway.run_service import AIRunService
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


def get_ai_routing_service(workspaces: WorkspaceServiceDependency) -> AIRoutingService:
    return AIRoutingService(workspaces)


AIRoutingServiceDependency = Annotated[AIRoutingService, Depends(get_ai_routing_service)]


def get_ai_run_service(
    settings: SettingsDependency,
    workspaces: WorkspaceServiceDependency,
    routing: AIRoutingServiceDependency,
) -> AIRunService:
    return AIRunService(settings, workspaces, routing)


AIRunServiceDependency = Annotated[AIRunService, Depends(get_ai_run_service)]
