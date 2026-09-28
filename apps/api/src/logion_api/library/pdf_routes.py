import asyncio
import hashlib
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import unquote
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.identity.dependencies import (
    AuthContextDependency,
    DatabaseSession,
    SettingsDependency,
    request_id,
)
from logion_api.identity.models import User
from logion_api.integrations.models import IntegrationCredential
from logion_api.integrations.network import integration_error
from logion_api.integrations.webdav import request_webdav
from logion_api.library.pdf_cache import cleanup, load_cached, lock_cache, store_cached
from logion_api.library.pdf_models import WebDAVUsage
from logion_api.library.pdf_validation import unzip_pdf, validate_pdf, webdav_path
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.schemas import FileLocator, LibraryCreate, LibraryResource

router = APIRouter(tags=["research-pdf"], dependencies=[Depends(require_enabled)])
BASE = "/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources"


async def credential_for(
    db: DatabaseSession, context: AuthContextDependency
) -> IntegrationCredential:
    await db.scalar(
        select(User.id).where(User.id == context.user.id).with_for_update(key_share=True)
    )
    credential = await db.scalar(
        select(IntegrationCredential)
        .where(
            IntegrationCredential.user_id == context.user.id,
            IntegrationCredential.provider == "webdav",
        )
        .with_for_update()
    )
    if credential is None or not credential.connected:
        raise integration_error("WEBDAV_CONNECTION_REQUIRED", 409)
    return credential


@router.get(
    BASE + "/{resource_id}/pdf",
    operation_id="research_pdf_get",
    response_class=StreamingResponse,
    responses={
        200: {"content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}}}
    },
)
async def get_pdf(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
    service: Service,
) -> StreamingResponse:
    await lock_cache(db)
    credential = await credential_for(db, context)
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    settings.pdf_cache_keyring.key(settings.pdf_cache_keyring.active)
    data = await load_cached(db, settings, resource, credential)
    if data is None:
        raise integration_error("PDF_NOT_PREPARED", 409)
    digest = hashlib.sha256(data).hexdigest()

    async def stream() -> AsyncIterator[bytes]:
        try:
            for offset in range(0, len(data), 65536):
                yield data[offset : offset + 65536]
        finally:
            # Retain the memory/concurrency lease until the response leaves the server.
            await db.rollback()

    return StreamingResponse(
        stream(),
        media_type="application/pdf",
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Content-Disposition": 'inline; filename="paper.pdf"',
            "Content-Length": str(len(data)),
            "X-Content-SHA256": digest,
        },
    )


@router.post(
    BASE + "/{resource_id}/pdf/prepare",
    status_code=204,
    response_class=Response,
    operation_id="research_pdf_prepare",
    dependencies=[Depends(write_boundary)],
)
async def prepare_pdf(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
    service: Service,
) -> Response:
    await lock_cache(db)
    credential = await credential_for(db, context)
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    settings.pdf_cache_keyring.key(settings.pdf_cache_keyring.active)
    await cleanup(db, settings)
    data = await load_cached(db, settings, resource, credential)
    if data is None:
        path, zipped = webdav_path(resource.file_locator)
        remote = await request_webdav(
            settings, credential, "GET", path, max_bytes=settings.pdf_max_bytes
        )
        if remote.status != 200:
            raise integration_error("PDF_REMOTE_UNAVAILABLE", 503)
        data = await asyncio.to_thread(
            unzip_pdf if zipped else validate_pdf, remote.body, settings.pdf_max_bytes
        )
        if not zipped and hashlib.sha256(data).hexdigest() != path.rsplit("/", 1)[1][:-4]:
            raise integration_error("PDF_HASH_MISMATCH")
    resource.sha256 = await store_cached(db, settings, resource, credential, data)
    await db.commit()
    return Response(status_code=204)


@router.post(
    BASE + "/pdf-import",
    response_model=LibraryResource,
    status_code=201,
    operation_id="research_pdf_import",
    dependencies=[Depends(write_boundary)],
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/pdf": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def import_pdf(
    workspace_id: UUID,
    space_id: UUID,
    request: Request,
    response: Response,
    context: AuthContextDependency,
    db: DatabaseSession,
    settings: SettingsDependency,
    service: Service,
    title: Annotated[str, Header(alias="X-PDF-Title", min_length=1, max_length=3600)],
) -> LibraryResource:
    await lock_cache(db)
    credential = await credential_for(db, context)
    await service.authorize(db, context, workspace_id, space_id, request_id(request), write=True)
    settings.pdf_cache_keyring.key(settings.pdf_cache_keyring.active)
    if request.headers.get("content-type", "").split(";")[0] != "application/pdf":
        raise integration_error("PDF_INVALID")
    try:
        title = unquote(title, encoding="utf-8", errors="strict").strip()
    except UnicodeDecodeError as exc:
        raise integration_error("PDF_TITLE_INVALID") from exc
    if not 1 <= len(title) <= 300 or any(ord(char) < 32 for char in title):
        raise integration_error("PDF_TITLE_INVALID")
    data = bytearray()
    async with asyncio.timeout(35):
        async for chunk in request.stream():
            if len(data) + len(chunk) > settings.pdf_max_bytes:
                raise integration_error("PDF_TOO_LARGE", 413)
            data.extend(chunk)
    body = validate_pdf(bytes(data), settings.pdf_max_bytes)
    del data
    digest = hashlib.sha256(body).hexdigest()
    existing = await db.scalar(
        service.scoped(workspace_id, space_id, context.user.id)
        .where(
            # Only a server-verified hash participates in deduplication.
            Resource.sha256 == digest,
        )
        .limit(1)
    )
    if existing is not None:
        response.status_code = 200
        result = LibraryResource.model_validate(existing)
        await db.commit()
        return result
    directory = await request_webdav(settings, credential, "MKCOL", "/dav/Logion", max_bytes=65536)
    if directory.status not in (201, 405):
        raise integration_error("PDF_UPLOAD_FAILED", 503)
    remote = await request_webdav(
        settings,
        credential,
        "PUT",
        f"/dav/Logion/{digest}.pdf",
        content=body,
        headers={"Content-Type": "application/pdf"},
        max_bytes=65536,
    )
    if remote.status not in (200, 201, 204):
        raise integration_error("PDF_UPLOAD_FAILED", 503)
    resource = await service.create(
        db,
        context,
        workspace_id,
        space_id,
        LibraryCreate(
            title=title,
            resource_type="paper",
            file_locator=FileLocator(
                kind="logion_webdav", path=f"Logion/{digest}.pdf", sha256=digest, size=len(body)
            ),
        ),
        request_id(request),
    )
    resource.sha256 = digest
    await store_cached(db, settings, resource, credential, body)
    result = LibraryResource.model_validate(resource)
    await db.commit()
    return result


class UsageStatus(BaseModel):
    month: str
    downloaded_bytes: int
    allowance_bytes: int = 3_000_000_000
    near_limit: bool
    pdf_max_bytes: int


@router.get(
    "/api/v1/research/pdf-usage", response_model=UsageStatus, operation_id="research_pdf_usage"
)
async def usage(
    context: AuthContextDependency, db: DatabaseSession, settings: SettingsDependency
) -> UsageStatus:
    month = utc_now().date().replace(day=1)
    row = await db.get(WebDAVUsage, (context.user.id, month))
    total = row.downloaded_bytes if row else 0
    return UsageStatus(
        month=month.isoformat(),
        downloaded_bytes=total,
        near_limit=total >= 2_700_000_000,
        pdf_max_bytes=settings.pdf_max_bytes,
    )
