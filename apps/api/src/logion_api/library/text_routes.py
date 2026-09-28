import unicodedata
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import select

from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession, request_id
from logion_api.integrations.network import integration_error
from logion_api.library.routes import Service, require_enabled, write_boundary
from logion_api.library.text_models import SourceText

MAX_TEXT_BYTES = 5 * 1024 * 1024


class SourceTextCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    pages: list[Annotated[str, StringConstraints(max_length=500000)]] = Field(
        min_length=1, max_length=10000
    )
    extracted_by: Annotated[str, StringConstraints(pattern=r"^pdfjs@\d+\.\d+\.\d+$", max_length=80)]
    normalization_version: Literal["utf8-nfc-lf-v1"] = "utf8-nfc-lf-v1"

    @model_validator(mode="after")
    def bounded(self) -> "SourceTextCreate":
        if sum(len(page.encode("utf-8")) + 1 for page in self.pages) > MAX_TEXT_BYTES:
            raise ValueError("Extracted text exceeds the 5 MiB limit")
        self.pages = [
            unicodedata.normalize("NFC", page.replace("\r\n", "\n").replace("\r", "\n"))
            for page in self.pages
        ]
        if sum(len(page.encode("utf-8")) + 1 for page in self.pages) > MAX_TEXT_BYTES:
            raise ValueError("Normalized text exceeds the 5 MiB limit")
        if any("\x00" in page for page in self.pages):
            raise ValueError("Extracted text contains NUL")
        return self


class SourceTextResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    resource_id: UUID
    file_sha256: str
    text: str
    page_offsets: list[dict[str, int]]
    extracted_by: str
    normalization_version: Literal["utf8-nfc-lf-v1"]
    version: int


router = APIRouter(
    prefix="/api/v1/workspaces/{workspace_id}/spaces/{space_id}/library/resources/{resource_id}/text",
    tags=["research-text"],
    dependencies=[Depends(require_enabled)],
)


@router.get("", response_model=SourceTextResponse, operation_id="research_source_text_get")
async def get_text(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> SourceTextResponse:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request)
    )
    row = await db.scalar(
        select(SourceText).where(
            SourceText.resource_id == resource.id,
            SourceText.file_sha256 == resource.sha256,
            SourceText.deleted_at.is_(None),
        )
    )
    if row is None:
        raise integration_error("SOURCE_TEXT_NOT_FOUND", 404)
    return SourceTextResponse.model_validate(row)


@router.post(
    "",
    response_model=SourceTextResponse,
    operation_id="research_source_text_create",
    dependencies=[Depends(write_boundary)],
)
async def upload_text(
    workspace_id: UUID,
    space_id: UUID,
    resource_id: UUID,
    payload: SourceTextCreate,
    request: Request,
    context: AuthContextDependency,
    db: DatabaseSession,
    service: Service,
) -> SourceTextResponse:
    resource = await service.get(
        db, context, workspace_id, space_id, resource_id, request_id(request), write=True
    )
    if resource.sha256 != payload.file_sha256:
        raise integration_error("SOURCE_FILE_CHANGED", 409)
    existing = await db.scalar(
        select(SourceText).where(
            SourceText.resource_id == resource.id, SourceText.file_sha256 == payload.file_sha256
        )
    )
    if existing is not None:
        return SourceTextResponse.model_validate(existing)
    offsets = []
    position = 0
    for page in payload.pages:
        end = position + len(page) + 1
        offsets.append({"start": position, "end": end})
        position = end
    row = SourceText(
        resource_id=resource.id,
        workspace_id=workspace_id,
        space_id=space_id,
        file_sha256=payload.file_sha256,
        text="\n".join(payload.pages) + "\n",
        page_offsets=offsets,
        extracted_by=payload.extracted_by,
    )
    db.add(row)
    await db.flush()
    result = SourceTextResponse.model_validate(row)
    await db.commit()
    return result
