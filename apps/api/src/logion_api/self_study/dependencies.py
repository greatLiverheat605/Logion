from typing import Annotated

from fastapi import Depends

from logion_api.identity.dependencies import SettingsDependency
from logion_api.self_study.service import SelfStudyService
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_self_study_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> SelfStudyService:
    return SelfStudyService(settings, workspaces)


SelfStudyServiceDependency = Annotated[SelfStudyService, Depends(get_self_study_service)]
