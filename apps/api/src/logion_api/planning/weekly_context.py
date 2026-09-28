"""The weekly AI boundary contains integers only, never private prose or idea activity."""

import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.models import AIRun
from logion_api.errors import APIError
from logion_api.identity.models import User
from logion_api.library.service import not_found
from logion_api.planning.models import WeeklyReview
from logion_api.planning.weekly_schemas import WeeklyStats
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import ROLE_PERMISSIONS, Permission, WorkspaceRole


def invalid_weekly_context() -> APIError:
    return APIError(
        code="AI_CONTEXT_TYPE_BLOCKED",
        message="Weekly comments require one current statistics snapshot.",
        status_code=422,
    )


def numeric_fields(row: WeeklyReview) -> dict[str, str]:
    try:
        stats = WeeklyStats.model_validate(row.stats)
    except ValidationError as exc:
        raise invalid_weekly_context() from exc
    return {"statistics": json.dumps(stats.model_dump(), sort_keys=True, separators=(",", ":"))}


async def weekly_context(
    db: AsyncSession,
    workspace_id: UUID,
    space_id: UUID,
    user_id: UUID,
    identifier: UUID,
    version: int,
) -> dict[str, str]:
    row = await db.scalar(
        select(WeeklyReview).where(
            WeeklyReview.id == identifier,
            WeeklyReview.workspace_id == workspace_id,
            WeeklyReview.space_id == space_id,
            WeeklyReview.user_id == user_id,
            WeeklyReview.deleted_at.is_(None),
        )
    )
    if row is None:
        raise not_found()
    if row.version != version or row.closed_at is not None:
        raise APIError(code="RESOURCE_VERSION_CONFLICT", message="Review changed.", status_code=409)
    return numeric_fields(row)


async def validate_weekly_run(
    db: AsyncSession,
    run: AIRun,
    fields: dict[str, str],
    *,
    lock: bool = False,
) -> None:
    if (
        run.task_type != "weekly_comment"
        or run.target_type != "weekly_review"
        or run.prompt_version != "research-v1/weekly_comment"
        or run.expected_output_fields != ["comment"]
        or run.context_entity_types != ["weekly_review"]
    ):
        raise invalid_weekly_context()
    space_id = await db.scalar(
        select(WeeklyReview.space_id).where(
            WeeklyReview.id == run.target_id,
            WeeklyReview.workspace_id == run.workspace_id,
            WeeklyReview.user_id == run.requested_by,
            WeeklyReview.deleted_at.is_(None),
        )
    )
    if space_id is None:
        raise not_found()
    membership = (
        select(WorkspaceMembership)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .join(Space, Space.workspace_id == Workspace.id)
        .join(User, User.id == WorkspaceMembership.user_id)
        .where(
            Workspace.id == run.workspace_id,
            Workspace.status == "active",
            Workspace.deleted_at.is_(None),
            Space.id == space_id,
            Space.status == "active",
            Space.deleted_at.is_(None),
            (Space.visibility == "shared") | (Space.owner_user_id == run.requested_by),
            WorkspaceMembership.user_id == run.requested_by,
            WorkspaceMembership.status == "active",
            WorkspaceMembership.role.in_(
                [
                    role.value
                    for role in WorkspaceRole
                    if Permission.AI_USE in ROLE_PERMISSIONS[role]
                ]
            ),
            User.status == "active",
        )
    )
    if (
        await db.scalar(membership.with_for_update(of=WorkspaceMembership) if lock else membership)
        is None
    ):
        raise not_found()
    if lock:
        await db.scalar(select(Space).where(Space.id == space_id).with_for_update())
    expected = await weekly_context(
        db, run.workspace_id, space_id, run.requested_by, run.target_id, run.target_version
    )
    if fields != expected:
        raise invalid_weekly_context()


def weekly_comment(output: dict[str, str]) -> str:
    value = output.get("comment")
    if (
        set(output) != {"comment"}
        or not isinstance(value, str)
        or not value.strip()
        or len(value) > 4000
        or "\x00" in value
    ):
        raise APIError(
            code="AI_DRAFT_SCHEMA_INVALID", message="Invalid weekly comment.", status_code=422
        )
    return value
