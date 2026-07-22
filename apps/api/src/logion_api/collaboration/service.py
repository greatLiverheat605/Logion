from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.collaboration.models import GroupFeedback, ReportSnapshot, ReviewRequest, Rubric
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

SharedModel = type[Rubric] | type[ReviewRequest] | type[GroupFeedback] | type[ReportSnapshot]


class CollaborationService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self.settings, self.workspaces = settings, workspaces

    async def authorize(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
        permission: Permission,
    ) -> Space:
        space = await self.workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        if space.visibility != "shared":
            raise APIError(
                code="RESOURCE_PERMISSION_DENIED",
                message="A shared Space is required.",
                status_code=403,
            )
        await self.workspaces.resolve_workspace(
            db, context, workspace_id, request_id=request_id, permission=permission
        )
        return space

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        model: SharedModel,
        values: dict[str, Any],
        request_id: str,
        entity_type: str,
    ) -> Any:
        permission = (
            Permission.REVIEW_WRITE if model is GroupFeedback else Permission.SHARED_PLAN_WRITE
        )
        await self.authorize(db, context, workspace_id, space_id, request_id, permission)
        await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
        entity_id = values.pop("id")
        existing: Any = await db.get(model, entity_id)
        if existing is not None and (
            existing.workspace_id != workspace_id or existing.space_id != space_id
        ):
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Shared record not found.", status_code=404
            )
        if existing is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        count = int(
            await db.scalar(
                select(func.count(model.id)).where(
                    model.workspace_id == workspace_id,
                    model.space_id == space_id,
                    model.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self.settings.collaboration_entity_per_space_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="Collaboration record limit reached.",
                status_code=409,
            )
        parents: dict[Any, tuple[Any, str]] = {
            ReviewRequest: (Rubric, "rubric_id"),
            GroupFeedback: (ReviewRequest, "review_id"),
            ReportSnapshot: (ReviewRequest, "review_id"),
        }
        if model in parents:
            parent_model, field = parents[model]
            parent = await db.scalar(
                select(parent_model.id).where(
                    parent_model.id == values[field],
                    parent_model.workspace_id == workspace_id,
                    parent_model.space_id == space_id,
                    parent_model.deleted_at.is_(None),
                )
            )
            if parent is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Shared parent not found.", status_code=404
                )
        item = model(
            id=entity_id,
            workspace_id=workspace_id,
            space_id=space_id,
            created_by=context.user.id,
            updated_by=context.user.id,
            **values,
        )
        db.add(item)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=f"collaboration.{entity_type}_created",
                result="success",
                actor_id=context.user.id,
                workspace_id=workspace_id,
                target_type=entity_type,
                target_id=item.id,
                metadata={},
            )
        )
        return item

    async def list_all(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        request_id: str,
    ) -> list[list[Any]]:
        await self.authorize(
            db, context, workspace_id, space_id, request_id, Permission.SHARED_CONTENT_READ
        )
        result = []
        for model_value in (Rubric, ReviewRequest, GroupFeedback, ReportSnapshot):
            model: Any = model_value
            result.append(
                list(
                    (
                        await db.scalars(
                            select(model)
                            .where(
                                model.workspace_id == workspace_id,
                                model.space_id == space_id,
                                model.deleted_at.is_(None),
                            )
                            .order_by(model.id)
                            .limit(10000)
                        )
                    ).all()
                )
            )
        return result
