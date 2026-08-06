from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import (
    RateLimiterDependency,
    SettingsDependency,
    get_security,
)
from logion_api.knowledge_space.service import KnowledgeService


def get_knowledge_service(
    settings: SettingsDependency,
    limiter: RateLimiterDependency,
) -> KnowledgeService:
    return KnowledgeService(settings, get_security(), limiter)


KnowledgeServiceDependency = Annotated[KnowledgeService, Depends(get_knowledge_service)]
