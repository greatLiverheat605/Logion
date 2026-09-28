from uuid import UUID

from sqlalchemy import Select, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.library.schemas import LibraryCreate, LibraryFields, LibraryUpdate, ReadingStatus
from logion_api.research.models import PaperRecord
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService


def not_found() -> APIError:
    return APIError(code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404)


async def map_legacy_paper(db: AsyncSession, paper: PaperRecord) -> Resource:
    """Also called by the legacy writer, so toggling v3 never leaves new papers unmapped."""
    resource = await db.scalar(select(Resource).where(Resource.legacy_paper_id == paper.id))
    if resource is None:
        resource = Resource(
            workspace_id=paper.workspace_id,
            space_id=paper.space_id,
            research_owner_id=paper.user_id,
            legacy_paper_id=paper.id,
            resource_type="paper",
            title=paper.title,
            citation_key=paper.citation_key,
            source_url=paper.source_url,
            page_index=[],
            version=paper.version,
            created_by=paper.created_by,
            updated_by=paper.updated_by,
            created_at=paper.created_at,
            updated_at=paper.updated_at,
            deleted_at=paper.deleted_at,
        )
        db.add(resource)
        await db.flush()
    return resource


class LibraryService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self.settings, self.workspaces = settings, workspaces

    async def authorize(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
        *,
        write: bool = False,
    ) -> None:
        await self.workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if write:
            member = await db.scalar(
                select(WorkspaceMembership.id)
                .where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == context.user.id,
                    WorkspaceMembership.status == "active",
                )
                .with_for_update()
            )
            if member is None:
                raise not_found()

    @staticmethod
    def scoped(workspace_id: UUID, space_id: UUID, user_id: UUID) -> Select[tuple[Resource]]:
        return select(Resource).where(
            Resource.workspace_id == workspace_id,
            Resource.space_id == space_id,
            Resource.research_owner_id == user_id,
            Resource.deleted_at.is_(None),
        )

    async def get(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        resource_id: UUID,
        request_id: str,
        *,
        write: bool = False,
    ) -> Resource:
        await self.authorize(db, context, workspace_id, space_id, request_id, write=write)
        query = self.scoped(workspace_id, space_id, context.user.id).where(
            Resource.id == resource_id
        )
        resource = await db.scalar(query.with_for_update() if write else query)
        if resource is None:
            raise not_found()
        return resource

    async def list(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
        *,
        status: ReadingStatus | None,
        tag: str | None,
        cursor: UUID | None,
        limit: int,
    ) -> tuple[list[Resource], UUID | None]:
        await self.authorize(db, context, workspace_id, space_id, request_id)
        query = self.scoped(workspace_id, space_id, context.user.id)
        if status is not None:
            query = query.where(Resource.reading_status == status)
        if tag is not None:
            query = query.where(Resource.tags.contains([tag]))
        if cursor is not None:
            query = query.where(Resource.id > cursor)
        rows = list(await db.scalars(query.order_by(Resource.id).limit(limit + 1)))
        return rows[:limit], rows[limit - 1].id if len(rows) > limit else None

    async def duplicate(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: LibraryFields,
        exclude_id: UUID | None = None,
    ) -> None:
        identifiers = [
            getattr(Resource, key) == value
            for key in ("doi", "arxiv_id", "pmid")
            if (value := getattr(payload, key)) is not None
        ]
        if not identifiers:
            return
        query = self.scoped(workspace_id, space_id, context.user.id).where(or_(*identifiers))
        if exclude_id is not None:
            query = query.where(Resource.id != exclude_id)
        existing = await db.scalar(query.order_by(Resource.id).limit(1))
        if existing is not None:
            raise APIError(
                code="LIBRARY_DUPLICATE",
                message="This literature already exists.",
                status_code=409,
                details={"existing_id": str(existing.id)},
            )

    @staticmethod
    def apply(resource: Resource, payload: LibraryFields) -> None:
        values = payload.model_dump(exclude={"expected_version"}, by_alias=True, exclude_none=False)
        values["csl"] = payload.csl.model_dump(
            by_alias=True, exclude_none=True, exclude_defaults=True
        )
        for key, value in values.items():
            setattr(resource, key, value)
        if resource.reading_status == "close_read" and resource.read_at is None:
            resource.read_at = utc_now()

    @staticmethod
    def audit(db: AsyncSession, context: AuthContext, request_id: str, action: str) -> None:
        # Personal audit only: workspace admins must not learn private record identities.
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=f"library.{action}",
                result="success",
                actor_id=context.user.id,
                target_type="research_resource",
                metadata={},
            )
        )

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        payload: LibraryCreate,
        request_id: str,
    ) -> Resource:
        await self.authorize(db, context, workspace_id, space_id, request_id, write=True)
        if any(tag.startswith("collection:") for tag in payload.tags):
            raise APIError(
                code="ZOTERO_COLLECTION_READ_ONLY",
                message="Zotero collections are read-only.",
                status_code=422,
            )
        await self.duplicate(db, context, workspace_id, space_id, payload)
        count = await db.scalar(
            select(func.count()).select_from(
                self.scoped(workspace_id, space_id, context.user.id).subquery()
            )
        )
        if (count or 0) >= self.settings.research_entity_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED", message="Library limit reached.", status_code=409
            )
        item = Resource(
            workspace_id=workspace_id,
            space_id=space_id,
            research_owner_id=context.user.id,
            created_by=context.user.id,
            updated_by=context.user.id,
            page_index=[],
        )
        self.apply(item, payload)
        try:
            async with db.begin_nested():
                db.add(item)
                await db.flush()
        except IntegrityError:
            await self.duplicate(db, context, workspace_id, space_id, payload)
            raise
        self.audit(db, context, request_id, "created")
        return item

    async def update(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        resource_id: UUID,
        payload: LibraryUpdate,
        request_id: str,
    ) -> Resource:
        item = await self.get(
            db, context, workspace_id, space_id, resource_id, request_id, write=True
        )
        self.check_version(item, payload.expected_version)
        if sorted(tag for tag in item.tags if tag.startswith("collection:")) != sorted(
            tag for tag in payload.tags if tag.startswith("collection:")
        ):
            raise APIError(
                code="ZOTERO_COLLECTION_READ_ONLY",
                message="Zotero collections are read-only.",
                status_code=422,
            )
        if item.zotero_item_key and any(
            getattr(payload, field) != getattr(item, field)
            for field in ("zotero_library_id", "zotero_item_key", "zotero_version")
        ):
            raise APIError(
                code="ZOTERO_IDENTITY_READ_ONLY",
                message="Zotero identity is read-only.",
                status_code=422,
            )
        await self.duplicate(db, context, workspace_id, space_id, payload, item.id)
        self.apply(item, payload)
        item.version += 1
        item.updated_at = utc_now()
        item.updated_by = context.user.id
        await db.flush()
        self.audit(db, context, request_id, "updated")
        return item

    async def delete(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        resource_id: UUID,
        expected_version: int,
        request_id: str,
    ) -> None:
        item = await self.get(
            db, context, workspace_id, space_id, resource_id, request_id, write=True
        )
        self.check_version(item, expected_version)
        item.deleted_at = item.updated_at = utc_now()
        item.version += 1
        item.updated_by = context.user.id
        self.audit(db, context, request_id, "deleted")

    @staticmethod
    def check_version(item: Resource, expected: int) -> None:
        if item.version != expected:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Resource changed.", status_code=409
            )
