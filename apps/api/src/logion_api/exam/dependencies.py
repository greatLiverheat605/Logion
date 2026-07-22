from typing import Annotated

from fastapi import Depends

from logion_api.exam.service import ExamService
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_exam_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> ExamService:
    return ExamService(settings, workspaces)


ExamServiceDependency = Annotated[ExamService, Depends(get_exam_service)]
