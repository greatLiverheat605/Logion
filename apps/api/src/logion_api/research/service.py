from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.service import AuthContext
from logion_api.research.models import (
    ExperimentRun,
    MetricRecord,
    PaperRecord,
    ResearchClaim,
    ResearchFeedback,
    ResearchQuestion,
)
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService

ResearchModel = (
    type[PaperRecord]
    | type[ResearchClaim]
    | type[ResearchQuestion]
    | type[ExperimentRun]
    | type[MetricRecord]
    | type[ResearchFeedback]
)


class ResearchService:
    def __init__(self, settings: Settings, workspaces: WorkspaceService) -> None:
        self.settings, self.workspaces = settings, workspaces

    async def create(
        self,
        db: AsyncSession,
        context: AuthContext,
        workspace_id: UUID,
        space_id: UUID,
        model: ResearchModel,
        values: dict[str, Any],
        request_id: str,
        entity_type: str,
    ) -> Any:
        await self.workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
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
        entity_id = values.pop("id")
        if await db.get(model, entity_id) is not None:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Identifier exists.", status_code=409
            )
        count = int(
            await db.scalar(
                select(func.count(model.id)).where(
                    model.workspace_id == workspace_id,
                    model.user_id == context.user.id,
                    model.deleted_at.is_(None),
                )
            )
            or 0
        )
        if count >= self.settings.research_entity_per_user_quota:
            raise APIError(
                code="RESOURCE_QUOTA_EXCEEDED",
                message="Research record limit reached.",
                status_code=409,
            )
        parents: dict[Any, tuple[Any, str]] = {
            ResearchClaim: (PaperRecord, "paper_id"),
            ExperimentRun: (ResearchQuestion, "question_id"),
            MetricRecord: (ExperimentRun, "run_id"),
            ResearchFeedback: (ResearchClaim, "claim_id"),
        }
        if model in parents:
            parent_model, field = parents[model]
            parent = await db.scalar(
                select(parent_model.id).where(
                    parent_model.id == values[field],
                    parent_model.workspace_id == workspace_id,
                    parent_model.space_id == space_id,
                    parent_model.user_id == context.user.id,
                    parent_model.deleted_at.is_(None),
                )
            )
            if parent is None:
                raise APIError(
                    code="RESOURCE_NOT_FOUND", message="Research parent not found.", status_code=404
                )
        item = model(
            id=entity_id,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=context.user.id,
            created_by=context.user.id,
            updated_by=context.user.id,
            **values,
        )
        db.add(item)
        await db.flush()
        db.add(
            new_audit_event(
                request_id=request_id,
                event_type=f"research.{entity_type}_created",
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
        await self.workspaces.resolve_space(
            db, context, workspace_id, space_id, request_id=request_id
        )
        result = []
        for model_value in (
            PaperRecord,
            ResearchClaim,
            ResearchQuestion,
            ExperimentRun,
            MetricRecord,
            ResearchFeedback,
        ):
            model: Any = model_value
            result.append(
                list(
                    (
                        await db.scalars(
                            select(model)
                            .where(
                                model.workspace_id == workspace_id,
                                model.space_id == space_id,
                                model.user_id == context.user.id,
                                model.deleted_at.is_(None),
                            )
                            .order_by(model.id)
                            .limit(10000)
                        )
                    ).all()
                )
            )
        return result
