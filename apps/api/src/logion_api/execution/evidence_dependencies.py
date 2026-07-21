from typing import Annotated

from fastapi import Depends

from logion_api.execution.evidence_service import EvidenceService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_evidence_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> EvidenceService:
    return EvidenceService(settings, workspaces)


EvidenceServiceDependency = Annotated[EvidenceService, Depends(get_evidence_service)]
