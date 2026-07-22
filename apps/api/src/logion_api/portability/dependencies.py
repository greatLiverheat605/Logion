from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.import_service import ImportService
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_portability_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> PortabilityService:
    return PortabilityService(settings, workspaces)


PortabilityServiceDependency = Annotated[PortabilityService, Depends(get_portability_service)]


def get_import_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> ImportService:
    return ImportService(settings, workspaces)


ImportServiceDependency = Annotated[ImportService, Depends(get_import_service)]


def get_account_deletion_service(settings: SettingsDependency) -> AccountDeletionService:
    return AccountDeletionService(settings)


AccountDeletionServiceDependency = Annotated[
    AccountDeletionService, Depends(get_account_deletion_service)
]
