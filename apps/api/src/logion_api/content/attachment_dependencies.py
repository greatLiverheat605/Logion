from typing import Annotated

from fastapi import Depends

from logion_api.content.attachment_scanner import (
    AttachmentScanner,
    ClamdInstreamScanner,
    DisabledAttachmentScanner,
)
from logion_api.content.attachment_service import AttachmentService
from logion_api.content.attachment_storage import FilesystemAttachmentStorage
from logion_api.identity.dependencies import SettingsDependency
from logion_api.workspaces.dependencies import WorkspaceServiceDependency


def get_attachment_scanner(settings: SettingsDependency) -> AttachmentScanner:
    if not settings.attachment_scanner_enabled:
        return DisabledAttachmentScanner()
    return ClamdInstreamScanner(
        settings.attachment_scanner_host,
        settings.attachment_scanner_port,
        settings.attachment_scanner_timeout_seconds,
        settings.attachment_scanner_chunk_bytes,
    )


AttachmentScannerDependency = Annotated[AttachmentScanner, Depends(get_attachment_scanner)]


def get_attachment_service(
    settings: SettingsDependency,
    workspaces: WorkspaceServiceDependency,
    scanner: AttachmentScannerDependency,
) -> AttachmentService:
    return AttachmentService(
        settings,
        workspaces,
        FilesystemAttachmentStorage(settings.attachment_root, settings.attachment_quarantine_root),
        scanner,
    )


AttachmentServiceDependency = Annotated[AttachmentService, Depends(get_attachment_service)]
