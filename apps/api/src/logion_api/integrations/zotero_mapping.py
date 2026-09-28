"""Map bounded Zotero pages without changing user reading state or local excerpts."""

import hashlib
import json
import re
import unicodedata
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.integrations.models import IntegrationCredential, ZoteroSyncState
from logion_api.integrations.network import integration_error
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.library.schemas import LibraryFields


def item_key(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Z0-9]{8}", value):
        raise integration_error("ZOTERO_RESPONSE_INVALID")
    return value


def fields(data: dict[str, Any]) -> LibraryFields:
    extra = str(data.get("extra", ""))
    identifiers: dict[str, str | None] = {}
    for name, value, normalize in (
        ("doi", data.get("DOI"), LibraryFields.normalize_doi),
        (
            "arxiv_id",
            data.get("archiveID")
            if data.get("archive") == "arXiv"
            else next(iter(re.findall(r"(?im)^arxiv:\s*(\S+)", extra)), None),
            LibraryFields.normalize_arxiv,
        ),
        (
            "pmid",
            next(iter(re.findall(r"(?im)^PMID:\s*(\d+)", extra)), None),
            LibraryFields.normalize_pmid,
        ),
    ):
        try:
            identifiers[name] = normalize(str(value)) if value else None
        except ValueError:
            identifiers[name] = None
    csl: dict[str, Any] = {
        "author": [
            {"literal": str(person["name"])[:2000]}
            if person.get("name")
            else {
                "family": str(person.get("lastName", ""))[:2000],
                "given": str(person.get("firstName", ""))[:2000],
            }
            for person in data.get("creators", [])[:100]
            if person.get("creatorType") == "author"
        ],
        "abstract": str(data.get("abstractNote", ""))[:30000],
        "language": str(data.get("language", ""))[:80],
    }
    for source, target in (
        ("publicationTitle", "container-title"),
        ("volume", "volume"),
        ("issue", "issue"),
        ("pages", "page"),
    ):
        if data.get(source):
            csl[target] = str(data[source])[:2000]
    year = re.search(r"\b([12]\d{3})\b", str(data.get("date", "")))
    if year:
        csl["issued"] = {"date-parts": [[int(year[1])]]}
    url = data.get("url") or None
    try:
        url = LibraryFields.validate_url(url)
    except (ValueError, TypeError):
        url = None
    kind = {"book": "book", "webpage": "web", "preprint": "preprint"}.get(
        str(data.get("itemType")), "paper"
    )
    return LibraryFields.model_validate(
        {
            "title": str(data.get("title") or "Untitled")[:300],
            "resource_type": kind,
            "csl": csl,
            "source_url": url,
            **identifiers,
            "tags": list(
                dict.fromkeys(
                    str(tag["tag"]).strip()[:80]
                    for tag in data.get("tags", [])
                    if tag.get("tag") and not str(tag["tag"]).startswith("collection:")
                )
            )[:50],
        }
    )


class ZoteroMapper:
    def __init__(
        self,
        db: AsyncSession,
        credential: IntegrationCredential,
        state: ZoteroSyncState,
        quota: int,
    ) -> None:
        self.db, self.credential, self.state, self.quota = db, credential, state, quota

    def scope(self) -> Select[tuple[Resource]]:
        return select(Resource).where(
            Resource.workspace_id == self.state.workspace_id,
            Resource.space_id == self.state.space_id,
            Resource.research_owner_id == self.credential.user_id,
        )

    async def mapped(self, key: str) -> Resource | None:
        identifier = self.state.item_map.get(key)
        if identifier:
            query = self.scope().where(Resource.id == UUID(identifier))
        else:
            query = self.scope().where(
                Resource.zotero_library_id == self.state.library_id,
                Resource.zotero_item_key == key,
            )
        resource: Resource | None = await self.db.scalar(query)
        return resource

    def remember(self, key: str, row: Resource) -> None:
        if key not in self.state.item_map and len(self.state.item_map) >= self.quota * 4:
            raise integration_error("RESOURCE_QUOTA_EXCEEDED", 409)
        self.state.item_map = {**self.state.item_map, key: str(row.id)}

    def collection_tags(self, row: Resource) -> list[str]:
        return list(
            dict.fromkeys(
                f"collection:{self.state.collections[key]}"[:80]
                for key in row.zotero_collection_keys
                if key in self.state.collections
            )
        )

    async def refresh_collection_tags(self) -> None:
        rows = await self.db.scalars(
            self.scope().where(
                Resource.zotero_library_id == self.state.library_id,
                Resource.zotero_sync_stopped.is_(False),
                Resource.deleted_at.is_(None),
            )
        )
        for row in rows:
            tags = [tag for tag in row.tags if not tag.startswith("collection:")]
            tags = list(dict.fromkeys(tags + self.collection_tags(row)))
            if len(tags) > 50:
                raise integration_error("ZOTERO_TAG_LIMIT")
            if tags != row.tags:
                row.tags = tags
                self.touch(row)

    @staticmethod
    def touch(row: Resource) -> None:
        row.version += 1
        row.updated_at = utc_now()

    async def apply(self, entries: list[Any]) -> None:
        for item in entries:
            key, version, data = item_key(item["key"]), int(item["version"]), item["data"]
            if not 0 <= version < 2**63 or not isinstance(data, dict):
                raise integration_error("ZOTERO_RESPONSE_INVALID")
            if self.state.phase == "collections":
                if key not in self.state.collections and len(self.state.collections) >= 10000:
                    raise integration_error("ZOTERO_COLLECTION_LIMIT")
                self.state.collections = {
                    **self.state.collections,
                    key: str(data["name"]).strip()[:69],
                }
            elif self.state.phase == "items":
                await self.resource(key, version, data)
            elif self.state.phase == "attachments":
                await self.attachment(key, data)
            elif self.state.phase == "annotations":
                await self.annotation(key, version, data)
        if self.state.phase == "collections":
            await self.refresh_collection_tags()

    async def resource(self, key: str, version: int, data: dict[str, Any]) -> None:
        if data.get("itemType") in {"note", "annotation"}:
            return
        # Standalone PDFs are valid top-level literature, too.
        row = await self.mapped(key)
        if row and (row.deleted_at or row.zotero_sync_stopped):
            return
        if data.get("deleted"):
            if row:
                self.archive(row)
            return
        payload = fields(data)
        if row is None:
            identifiers = [
                getattr(Resource, name) == value
                for name in ("doi", "arxiv_id", "pmid")
                if (value := getattr(payload, name)) is not None
            ]
            matches = (
                list(
                    await self.db.scalars(
                        self.scope().where(
                            Resource.deleted_at.is_(None),
                            or_(*identifiers),
                        )
                    )
                )
                if identifiers
                else []
            )
            if len(matches) > 1:
                raise integration_error("ZOTERO_IDENTIFIER_CONFLICT", 409)
            row = matches[0] if matches else None
        if row is None:
            count = await self.db.scalar(
                select(func.count()).select_from(
                    self.scope().where(Resource.deleted_at.is_(None)).subquery()
                )
            )
            if (count or 0) >= self.quota:
                raise integration_error("RESOURCE_QUOTA_EXCEEDED", 409)
            row = Resource(
                workspace_id=self.state.workspace_id,
                space_id=self.state.space_id,
                research_owner_id=self.credential.user_id,
                created_by=self.credential.user_id,
                updated_by=self.credential.user_id,
                resource_type=payload.resource_type,
                title=payload.title,
                page_index=[],
            )
            self.db.add(row)
            await self.db.flush()
        self.remember(key, row)
        if row.zotero_sync_stopped or row.zotero_library_id not in (None, self.state.library_id):
            return
        if row.zotero_item_key and row.zotero_item_key != key:
            return  # Alias deduplication preserves the canonical upstream identity.
        if row.zotero_version is not None and row.zotero_version >= version:
            return
        for name in ("title", "resource_type", "source_url", "doi", "arxiv_id", "pmid"):
            setattr(row, name, getattr(payload, name))
        row.csl = payload.csl.model_dump(by_alias=True, exclude_none=True, exclude_defaults=True)
        row.zotero_library_id, row.zotero_item_key, row.zotero_version = (
            self.state.library_id,
            key,
            version,
        )
        row.zotero_collection_keys = [item_key(value) for value in data.get("collections", [])]
        row.tags = list(dict.fromkeys(payload.tags + self.collection_tags(row)))
        if len(row.tags) > 50:
            raise integration_error("ZOTERO_TAG_LIMIT")
        self.touch(row)
        if data.get("itemType") == "attachment":
            await self.attachment(key, data)

    async def attachment(self, key: str, data: dict[str, Any]) -> None:
        if data.get("contentType") != "application/pdf":
            return
        row = await self.mapped(item_key(data.get("parentItem") or key))
        if row is None or row.deleted_at or row.zotero_sync_stopped:
            return
        self.remember(key, row)
        if data.get("deleted"):
            if row.file_locator and row.file_locator.get("path") == f"zotero/{key}.zip":
                row.file_locator = None
                self.touch(row)
            return
        # Stable first attachment selection when a paper has several PDFs.
        if row.file_locator is None or row.file_locator.get("path") == f"zotero/{key}.zip":
            locator: dict[str, object] = {"kind": "zotero_webdav", "path": f"zotero/{key}.zip"}
            if row.file_locator != locator:
                row.file_locator = locator
                self.touch(row)

    async def annotation(self, key: str, version: int, data: dict[str, Any]) -> None:
        row = await self.mapped(item_key(data["parentItem"]))
        if row is None or row.deleted_at or row.zotero_sync_stopped:
            return
        text = unicodedata.normalize(
            "NFC",
            str(data.get("annotationText") or data.get("annotationComment") or "")
            .replace("\r\n", "\n")
            .replace("\r", "\n"),
        )
        if not text.strip():
            return  # Ink/image annotations have no text excerpt.
        if len(text) > 20000 or len(text.encode()) > 32768:
            raise integration_error("ZOTERO_ANNOTATION_TOO_LARGE")
        existing = list(
            await self.db.scalars(
                select(SourceExcerpt).where(
                    SourceExcerpt.resource_id == row.id,
                    SourceExcerpt.zotero_annotation_key == key,
                )
            )
        )
        if any(
            item.zotero_annotation_version is not None and item.zotero_annotation_version >= version
            for item in existing
        ):
            return
        for item in existing:
            if item.status == "active":
                item.status, item.stale_at, item.updated_at = "stale", utc_now(), utc_now()
                item.version += 1
        if data.get("deleted"):
            return
        position = json.loads(data["annotationPosition"])
        page = int(position["pageIndex"]) + 1
        if not 1 <= page <= 100000:
            raise integration_error("ZOTERO_RESPONSE_INVALID")
        source_key = f"zotero:{self.state.library_id}:{data['parentItem']}:{version}"
        self.db.add(
            SourceExcerpt(
                workspace_id=row.workspace_id,
                space_id=row.space_id,
                resource_id=row.id,
                resource_version=row.version,
                origin="zotero",
                zotero_annotation_key=key,
                zotero_annotation_version=version,
                source_version_key=source_key,
                source_version_sha256=hashlib.sha256(source_key.encode()).hexdigest(),
                excerpt_text=text,
                excerpt_sha256=hashlib.sha256(text.encode()).hexdigest(),
                page_start=page,
                page_end=page,
                created_by=self.credential.user_id,
                updated_by=self.credential.user_id,
            )
        )

    @staticmethod
    def archive(row: Resource) -> None:
        row.reading_status, row.zotero_sync_stopped = "archived", True
        ZoteroMapper.touch(row)

    async def deleted(self, data: dict[str, Any]) -> None:
        keys = {item_key(value) for value in data.get("items", [])}
        for key in keys:
            row = await self.mapped(key)
            if row and not row.zotero_sync_stopped and not row.deleted_at:
                if row.zotero_item_key == key:
                    self.archive(row)
                elif row.file_locator and row.file_locator.get("path") == f"zotero/{key}.zip":
                    row.file_locator = None
                    self.touch(row)
        excerpts = await self.db.scalars(
            select(SourceExcerpt).where(
                SourceExcerpt.resource_id.in_(self.scope().with_only_columns(Resource.id)),
                SourceExcerpt.zotero_annotation_key.in_(keys),
                SourceExcerpt.status == "active",
            )
        )
        for excerpt in excerpts:
            excerpt.status, excerpt.stale_at, excerpt.updated_at = "stale", utc_now(), utc_now()
            excerpt.version += 1
        removed = {item_key(value) for value in data.get("collections", [])}
        self.state.collections = {
            key: value for key, value in self.state.collections.items() if key not in removed
        }
        await self.refresh_collection_tags()
