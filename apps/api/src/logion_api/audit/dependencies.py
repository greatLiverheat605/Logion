from typing import Annotated

from fastapi import Depends

from logion_api.audit.service import AuditQueryService
from logion_api.identity.dependencies import get_security


def get_audit_query_service() -> AuditQueryService:
    return AuditQueryService(get_security())


AuditQueryServiceDependency = Annotated[
    AuditQueryService,
    Depends(get_audit_query_service),
]
