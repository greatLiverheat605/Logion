import csv
import hashlib
import io
import json
import re
from datetime import timedelta
from pathlib import PurePath
from typing import Annotated, Any, Literal
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from logion_api.config import Settings
from logion_api.content.models import Note, Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.portability.crypto import ImportPreviewCipher
from logion_api.portability.models import DataImportPreview
from logion_api.portability.schemas import ImportPreviewCreate
from logion_api.research.models import PaperRecord
from logion_api.self_study.models import InboxItem
from logion_api.workspaces.models import Space, WorkspaceMembership
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

ImportKind = Literal["note", "resource", "paper", "inbox_item"]
MAX_RECORDS = 1000


class NormalizedRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: ImportKind
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    body: Annotated[str, StringConstraints(max_length=100_000)] = ""
    source_url: Annotated[str, StringConstraints(max_length=2000)] | None = None
    citation_key: Annotated[str, StringConstraints(max_length=160)] | None = None
    resource_type: Literal["link", "pdf_index"] | None = None
    pdf_filename: Annotated[str, StringConstraints(max_length=255)] | None = None
    page_count: int | None = Field(default=None, ge=1, le=100_000)
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")] | None = None
    page_index: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)


class ImportService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self._settings = settings
        self._workspaces = workspaces
        self._cipher = ImportPreviewCipher(settings)

    async def preview(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        payload: ImportPreviewCreate,
        request_id: str,
    ) -> DataImportPreview:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        existing = await db.get(DataImportPreview, payload.id)
        if existing is not None:
            if existing.workspace_id == workspace_id and existing.requested_by == context.user.id:
                return existing
            raise self._not_found()
        records, warnings = self._parse(payload)
        normalized = json.dumps(
            [row.model_dump(mode="json") for row in records],
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        ciphertext, nonce, key_id = self._cipher.encrypt_preview(
            payload.id, workspace_id, normalized
        )
        counts = {kind: 0 for kind in ("note", "resource", "paper", "inbox_item")}
        for row in records:
            counts[row.kind] += 1
        now = utc_now()
        preview = DataImportPreview(
            id=payload.id,
            workspace_id=workspace_id,
            requested_by=context.user.id,
            source_format=payload.source_format,
            source_filename=payload.source_filename,
            source_sha256=hashlib.sha256(payload.content.encode()).hexdigest(),
            normalized_ciphertext=ciphertext,
            normalized_nonce=nonce,
            normalized_encryption_key_id=key_id,
            counts={key: value for key, value in counts.items() if value},
            warnings=warnings,
            expires_at=now + timedelta(hours=2),
        )
        db.add(preview)
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="data.import_previewed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="data_import",
                target_id=preview.id,
                metadata={
                    "source_format": payload.source_format,
                    "counts": preview.counts,
                    "warning_count": len(warnings),
                },
            )
        )
        await db.flush()
        return preview

    async def list_previews(
        self, db: AsyncSession, context: AuthContext, workspace_id: UUID, request_id: str
    ) -> list[DataImportPreview]:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        return list(
            (
                await db.scalars(
                    select(DataImportPreview)
                    .where(
                        DataImportPreview.workspace_id == workspace_id,
                        DataImportPreview.requested_by == context.user.id,
                    )
                    .order_by(DataImportPreview.created_at.desc(), DataImportPreview.id.desc())
                    .limit(50)
                )
            ).all()
        )

    async def commit(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        preview_id: UUID,
        target_space_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> DataImportPreview:
        await self._workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=Permission.WORKSPACE_READ
        )
        await db.scalar(
            select(WorkspaceMembership.id)
            .where(
                WorkspaceMembership.workspace_id == workspace_id,
                WorkspaceMembership.user_id == context.user.id,
                WorkspaceMembership.status == "active",
            )
            .with_for_update()
        )
        space = await db.scalar(
            select(Space).where(
                Space.id == target_space_id,
                Space.workspace_id == workspace_id,
                Space.owner_user_id == context.user.id,
                Space.visibility == "private",
                Space.status == "active",
            )
        )
        if space is None:
            raise APIError(
                code="IMPORT_TARGET_NOT_FOUND",
                message="Choose an active private Space that you own.",
                status_code=404,
            )
        preview = await db.scalar(
            select(DataImportPreview)
            .where(
                DataImportPreview.id == preview_id,
                DataImportPreview.workspace_id == workspace_id,
                DataImportPreview.requested_by == context.user.id,
            )
            .with_for_update()
        )
        if preview is None:
            raise self._not_found()
        if preview.version != expected_version:
            raise APIError(
                code="VERSION_CONFLICT",
                message="The import preview changed. Refresh before retrying.",
                status_code=409,
            )
        if preview.status != "previewed" or preview.expires_at <= utc_now():
            raise APIError(
                code="IMPORT_PREVIEW_EXPIRED",
                message="The import preview expired or was already used.",
                status_code=409,
            )
        records = self._decrypt_records(preview)
        await self._check_quotas(db, context.user.id, workspace_id, target_space_id, records)
        for row in records:
            common = {
                "id": uuid7(),
                "workspace_id": workspace_id,
                "space_id": target_space_id,
                "created_by": context.user.id,
                "updated_by": context.user.id,
            }
            if row.kind == "note":
                db.add(Note(**common, task_id=None, title=row.title[:200], markdown_body=row.body))
            elif row.kind == "resource":
                db.add(
                    Resource(
                        **common,
                        task_id=None,
                        resource_type=row.resource_type or "link",
                        title=row.title,
                        source_url=row.source_url,
                        pdf_filename=row.pdf_filename,
                        page_count=row.page_count,
                        sha256=row.sha256,
                        page_index=row.page_index,
                    )
                )
            elif row.kind == "paper":
                db.add(
                    PaperRecord(
                        **common,
                        user_id=context.user.id,
                        title=row.title,
                        citation_key=row.citation_key or f"imported-{uuid7()}",
                        source_url=row.source_url,
                    )
                )
            else:
                db.add(
                    InboxItem(
                        **common,
                        user_id=context.user.id,
                        title=row.title[:160],
                        note=row.body,
                    )
                )
        preview.status = "imported"
        preview.imported_space_id = target_space_id
        preview.imported_at = utc_now()
        preview.normalized_ciphertext = None
        preview.normalized_nonce = None
        preview.normalized_encryption_key_id = None
        preview.version += 1
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type="data.import_committed",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type="data_import",
                target_id=preview.id,
                metadata={"counts": preview.counts, "target_space_id": str(target_space_id)},
            )
        )
        await db.flush()
        return preview

    def _parse(self, payload: ImportPreviewCreate) -> tuple[list[NormalizedRecord], list[str]]:
        try:
            if "\x00" in payload.content:
                raise ValueError("NUL is not allowed")
            if payload.source_format == "logion_json":
                records, warnings = self._parse_json(payload.content)
            elif payload.source_format == "markdown":
                title = PurePath(payload.source_filename).stem.strip() or "Imported note"
                records, warnings = (
                    [NormalizedRecord(kind="note", title=title, body=payload.content)],
                    [],
                )
            elif payload.source_format == "csv":
                records, warnings = self._parse_csv(payload.content), []
            else:
                records, warnings = self._parse_bibtex(payload.content), []
            if not records:
                raise ValueError("no supported records")
            if len(records) > MAX_RECORDS:
                raise ValueError("too many records")
            return records, warnings
        except (csv.Error, json.JSONDecodeError, UnicodeError, ValidationError, ValueError) as exc:
            raise APIError(
                code="IMPORT_SOURCE_INVALID",
                message="The import source is invalid or contains unsupported data.",
                status_code=422,
            ) from exc

    @staticmethod
    def _parse_json(content: str) -> tuple[list[NormalizedRecord], list[str]]:
        package = json.loads(content)
        if not isinstance(package, dict) or package.get("schema_version") != "logion-export-v1":
            raise ValueError("unsupported schema")
        objects = package.get("objects")
        if not isinstance(objects, dict):
            raise ValueError("objects missing")
        records: list[NormalizedRecord] = []
        for value in objects.get("notes", []):
            if not isinstance(value, dict):
                raise ValueError("invalid note")
            records.append(
                NormalizedRecord(
                    kind="note",
                    title=ImportService._required_text(value.get("title")),
                    body=value.get("markdown_body", ""),
                )
            )
        for value in objects.get("resources", []):
            if not isinstance(value, dict):
                raise ValueError("invalid resource")
            records.append(
                NormalizedRecord(
                    kind="resource",
                    title=ImportService._required_text(value.get("title")),
                    resource_type=value.get("resource_type"),
                    source_url=ImportService._url(value.get("source_url")),
                    pdf_filename=value.get("pdf_filename"),
                    page_count=value.get("page_count"),
                    sha256=value.get("sha256"),
                    page_index=value.get("page_index", []),
                )
            )
        for value in objects.get("paper_records", []):
            if not isinstance(value, dict):
                raise ValueError("invalid paper")
            records.append(
                NormalizedRecord(
                    kind="paper",
                    title=ImportService._required_text(value.get("title")),
                    citation_key=value.get("citation_key"),
                    source_url=ImportService._url(value.get("source_url")),
                )
            )
        supported = {"notes", "resources", "paper_records", "spaces"}
        skipped = sorted(
            key
            for key, rows in objects.items()
            if key not in supported and isinstance(rows, list) and rows
        )
        warnings = [f"Skipped unsupported object type: {key}" for key in skipped]
        return records, warnings

    @staticmethod
    def _parse_csv(content: str) -> list[NormalizedRecord]:
        reader = csv.DictReader(io.StringIO(content, newline=""))
        if reader.fieldnames is None or "title" not in reader.fieldnames:
            raise ValueError("CSV title column required")
        records = []
        for row in reader:
            records.append(
                NormalizedRecord(
                    kind="inbox_item",
                    title=ImportService._required_text(row.get("title")),
                    body=row.get("note") or row.get("description") or "",
                )
            )
        return records

    @staticmethod
    def _parse_bibtex(content: str) -> list[NormalizedRecord]:
        records: list[NormalizedRecord] = []
        for chunk in re.split(r"(?=@[A-Za-z]+\s*\{)", content):
            header = re.match(r"@[A-Za-z]+\s*\{\s*([^,\s]+)\s*,", chunk)
            if header is None:
                continue
            fields: dict[str, str] = {}
            for match in re.finditer(
                r"(?im)^\s*([A-Za-z]+)\s*=\s*[\{\"]([^\}\"]*)[\}\"]\s*,?\s*$",
                chunk,
            ):
                fields[match.group(1).lower()] = match.group(2).strip()
            records.append(
                NormalizedRecord(
                    kind="paper",
                    title=fields.get("title") or header.group(1),
                    citation_key=header.group(1)[:160],
                    source_url=ImportService._url(fields.get("url")),
                )
            )
        return records

    def _decrypt_records(self, preview: DataImportPreview) -> list[NormalizedRecord]:
        try:
            value = json.loads(self._cipher.decrypt_preview(preview))
            if not isinstance(value, list) or len(value) > MAX_RECORDS:
                raise ValueError("invalid normalized records")
            return [NormalizedRecord.model_validate(row) for row in value]
        except (json.JSONDecodeError, UnicodeError, ValidationError, ValueError) as exc:
            raise APIError(
                code="IMPORT_PREVIEW_UNAVAILABLE",
                message="The encrypted import preview is unavailable.",
                status_code=503,
            ) from exc

    async def _check_quotas(
        self,
        db: AsyncSession,
        user_id: UUID,
        workspace_id: UUID,
        target_space_id: UUID,
        records: list[NormalizedRecord],
    ) -> None:
        counts = {
            kind: sum(row.kind == kind for row in records)
            for kind in ("note", "resource", "paper", "inbox_item")
        }
        checks = (
            (Note, counts["note"], self._settings.content_per_space_quota),
            (Resource, counts["resource"], self._settings.content_per_space_quota),
            (PaperRecord, counts["paper"], self._settings.research_entity_per_user_quota),
            (InboxItem, counts["inbox_item"], self._settings.self_study_entity_per_user_quota),
        )
        for model, added, limit in checks:
            if not added:
                continue
            query = select(func.count(model.id)).where(
                model.workspace_id == workspace_id,
                model.deleted_at.is_(None),
            )
            if model in (Note, Resource):
                query = query.where(model.space_id == target_space_id)
            if hasattr(model, "user_id"):
                query = query.where(model.user_id == user_id)
            current = int(await db.scalar(query) or 0)
            if current + added > limit:
                raise APIError(
                    code="IMPORT_QUOTA_EXCEEDED",
                    message="The import would exceed a workspace data limit.",
                    status_code=409,
                )

    @staticmethod
    def _url(value: Any) -> str | None:
        if value in (None, ""):
            return None
        if not isinstance(value, str) or len(value) > 2000:
            raise ValueError("invalid URL")
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
            raise ValueError("invalid URL")
        return value

    @staticmethod
    def _required_text(value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("required text missing")
        return value

    @staticmethod
    def _not_found() -> APIError:
        return APIError(code="IMPORT_NOT_FOUND", message="Import not found.", status_code=404)
