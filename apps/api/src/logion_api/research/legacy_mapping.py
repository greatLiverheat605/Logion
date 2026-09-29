"""Keep legacy paper writes visible after restoring the forward application."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Resource
from logion_api.research.models import PaperRecord


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
