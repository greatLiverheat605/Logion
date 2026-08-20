from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Note, Resource
from logion_api.errors import APIError
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.execution.models import Task
from logion_api.memory.models import Topic
from logion_api.research.models import ResearchClaim
from logion_api.self_study.models import StudyProject
from logion_api.workbenches.schemas import (
    WorkbenchLinkMutableV1,
    WorkbenchTargetBase,
    WorkbenchTargetV1,
)
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership

TargetKind = Literal["task", "source", "topic", "note", "evidence", "claim", "project"]

_TARGET_MODELS: dict[str, Any] = {
    "task": Task,
    "source": Resource,
    "topic": Topic,
    "note": Note,
    "evidence": EvidenceItem,
    "claim": ResearchClaim,
    "project": StudyProject,
}


class WorkbenchTargetRegistry:
    async def is_authorized(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        target: WorkbenchTargetV1,
    ) -> bool:
        model = _TARGET_MODELS.get(target.kind)
        if model is None:
            raise _schema_error()

        filters: list[Any] = [
            model.id == target.id,
            model.deleted_at.is_(None),
            Space.id == model.space_id,
            Space.workspace_id == model.workspace_id,
            Space.status == "active",
            Space.deleted_at.is_(None),
            or_(Space.visibility == "shared", Space.owner_user_id == owner_user_id),
            Workspace.id == model.workspace_id,
            Workspace.status == "active",
            Workspace.deleted_at.is_(None),
            WorkspaceMembership.workspace_id == model.workspace_id,
            WorkspaceMembership.user_id == owner_user_id,
            WorkspaceMembership.status == "active",
        ]
        if target.kind in ("claim", "project"):
            filters.append(model.user_id == owner_user_id)

        statement = (
            select(model.id)
            .select_from(model)
            .join(Space, Space.id == model.space_id)
            .join(Workspace, Workspace.id == model.workspace_id)
            .join(
                WorkspaceMembership,
                WorkspaceMembership.workspace_id == model.workspace_id,
            )
            .where(*filters)
        )
        return await db.scalar(statement) is not None

    async def require_authorized(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        target: WorkbenchTargetV1,
    ) -> None:
        if not await self.is_authorized(db, owner_user_id, target):
            raise _not_found_error()

    async def is_link_authorized(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        mutable: WorkbenchLinkMutableV1,
    ) -> bool:
        if not await self.is_authorized(db, owner_user_id, mutable.target):
            return False
        for value in mutable.attributes.values():
            if isinstance(value, WorkbenchTargetBase) and not await self.is_authorized(
                db, owner_user_id, value
            ):
                return False
        return True

    async def require_link_authorized(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        mutable: WorkbenchLinkMutableV1,
    ) -> None:
        if not await self.is_link_authorized(db, owner_user_id, mutable):
            raise _not_found_error()


def _not_found_error() -> APIError:
    return APIError(code="RESOURCE_NOT_FOUND", message="Workbench not found.", status_code=404)


def _schema_error() -> APIError:
    return APIError(
        code="WORKBENCH_SCHEMA_INVALID",
        message="The Workbench request is invalid.",
        status_code=422,
    )
