from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Note, Resource
from logion_api.errors import APIError
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.execution.models import StudySession, Task
from logion_api.identity.service import AuthContext
from logion_api.knowledge_space.models import KnowledgeCitation
from logion_api.planning.models import LearningGoal
from logion_api.workspaces.models import Space
from logion_api.workspaces.permissions import Permission
from logion_api.workspaces.service import WorkspaceService

DeleteEntityType = Literal["learning_goal", "task", "note"]
DELETE_MODELS: dict[str, Any] = {"learning_goal": LearningGoal, "task": Task, "note": Note}


@dataclass
class DeletionScope:
    root: Any
    deleted: list[tuple[str, Any]]
    detached: list[tuple[str, Any]]
    impact: dict[str, int]
    blockers: dict[str, int]


async def deletion_scope(
    db: AsyncSession,
    workspaces: WorkspaceService,
    context: AuthContext,
    workspace_id: UUID,
    entity_type: DeleteEntityType,
    entity_id: UUID,
    request_id: str,
) -> DeletionScope:
    """Authorize and lock the full scope before changing any entity or ledger row."""
    model = DELETE_MODELS[entity_type]
    root = await db.scalar(
        select(model).where(model.id == entity_id, model.workspace_id == workspace_id)
    )
    if root is None:
        raise APIError(code="RESOURCE_NOT_FOUND", message="Resource not found.", status_code=404)
    space_id = root.space_id
    space = await workspaces.resolve_space(
        db, context, workspace_id, space_id, request_id=request_id
    )
    if space.visibility == "shared":
        await workspaces.resolve_workspace(
            db,
            context,
            workspace_id,
            request_id=request_id,
            permission=Permission.SHARED_PLAN_WRITE,
        )
    # Content, Evidence and KnowledgeCitation writes use this same Space lock.
    await db.scalar(select(Space.id).where(Space.id == space_id).with_for_update())
    root = await db.scalar(
        select(model)
        .where(model.id == entity_id, model.workspace_id == workspace_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert root is not None
    deleted: list[tuple[str, Any]] = [(entity_type, root)]
    detached: list[tuple[str, Any]] = []
    notes: list[Any] = []
    tasks = [root] if entity_type == "task" else []
    if entity_type == "learning_goal":
        tasks = list(
            await db.scalars(
                select(Task)
                .where(
                    Task.workspace_id == workspace_id,
                    Task.goal_id == root.id,
                    Task.deleted_at.is_(None),
                )
                .order_by(Task.id)
                .with_for_update()
            )
        )
        deleted.extend(("task", task) for task in tasks)
    if tasks:
        task_ids = [task.id for task in tasks]
        for child_type, child_model in (
            ("note", Note),
            ("resource", Resource),
            ("study_session", StudySession),
        ):
            children = list(
                await db.scalars(
                    select(child_model)
                    .where(
                        child_model.workspace_id == workspace_id,
                        child_model.task_id.in_(task_ids),
                        child_model.deleted_at.is_(None),
                    )
                    .order_by(child_model.id)
                    .with_for_update()
                )
            )
            if child_type == "note":
                notes = children
            destination = (
                detached if entity_type == "task" and child_type != "study_session" else deleted
            )
            destination.extend((child_type, child) for child in children)
    if entity_type == "note":
        notes = [root]
    if any(child.space_id != space_id for _, child in deleted + detached):
        raise APIError(
            code="SYNC_OPERATION_FORBIDDEN",
            message="Deletion scope is unavailable.",
            status_code=403,
        )
    blockers: dict[str, int] = {}
    for label, ref_model in (
        ("evidence_count", EvidenceItem),
        ("citation_count", KnowledgeCitation),
    ):
        query = select(ref_model.space_id).where(
            ref_model.workspace_id == workspace_id,
            ref_model.note_id.in_([note.id for note in notes]),
            ref_model.deleted_at.is_(None),
        )
        if ref_model is KnowledgeCitation:
            query = query.where(KnowledgeCitation.status == "active")
        reference_spaces = list(await db.scalars(query))
        if any(reference_space != space_id for reference_space in reference_spaces):
            raise APIError(
                code="SYNC_OPERATION_FORBIDDEN",
                message="Deletion scope is unavailable.",
                status_code=403,
            )
        blockers[label] = len(reference_spaces)
    impact = {
        f"deleted_{kind}": sum(
            kind == item_type and item.deleted_at is None for item_type, item in deleted
        )
        for kind in ("learning_goal", "task", "note", "resource", "study_session")
    }
    impact.update(
        {
            f"detached_{kind}": sum(kind == item_type for item_type, _ in detached)
            for kind in ("note", "resource")
        }
    )
    return DeletionScope(root, deleted, detached, impact, blockers)


def require_unreferenced(scope: DeletionScope) -> None:
    if any(scope.blockers.values()):
        raise APIError(
            code="SYNC_DELETE_BLOCKED_BY_REFERENCE",
            message="Detach active Note references before deletion.",
            status_code=409,
            retryable=False,
            details=scope.blockers,
        )
