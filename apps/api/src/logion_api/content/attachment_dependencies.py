from typing import Annotated

from fastapi import Depends

from logion_api.content.attachment_service import AttachmentService
from logion_api.content.attachment_storage import FilesystemAttachmentStorage
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_attachment_service(
    settings: SettingsDependency, workspaces: WorkspaceServiceDependency
) -> AttachmentService:
    return AttachmentService(
        settings,
        workspaces,
        FilesystemAttachmentStorage(settings.attachment_root),
    )


AttachmentServiceDependency = Annotated[AttachmentService, Depends(get_attachment_service)]
