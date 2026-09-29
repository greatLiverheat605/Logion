"""Revalidate export ownership and represented spaces during rollback."""

from typing import Any
from uuid import UUID

from sqlalchemy import Uuid, any_, literal, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.errors import APIError
from logion_api.identity.models import User
from logion_api.portability.models import DataExportJob
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership


def in_ids(column: Any, values: list[UUID]) -> Any:
    # One typed array bind avoids PostgreSQL's parameter ceiling on large libraries.
    return column == any_(literal(values, type_=ARRAY(Uuid())))


async def require_export_access(
    db: AsyncSession,
    job: DataExportJob,
    represented_spaces: list[UUID] | None = None,
) -> list[Space]:
    # Account deletion locks User first. Membership changes lock Workspace first;
    # export then takes Space locks in UUID order, and never locks Membership.
    user = await db.scalar(
        select(User.id)
        .where(
            User.id == job.requested_by,
            User.status == "active",
            User.email_verified_at.is_not(None),
        )
        .with_for_update(read=True, of=User)
    )
    workspace = await db.scalar(
        select(Workspace.id)
        .where(
            Workspace.id == job.workspace_id,
            Workspace.status == "active",
            Workspace.deleted_at.is_(None),
        )
        .with_for_update(read=True, of=Workspace)
    )
    member = await db.scalar(
        select(WorkspaceMembership.id).where(
            WorkspaceMembership.workspace_id == job.workspace_id,
            WorkspaceMembership.user_id == job.requested_by,
            WorkspaceMembership.status == "active",
        )
    )
    if user is None or workspace is None or member is None:
        raise APIError(code="EXPORT_NOT_FOUND", message="Export not found.", status_code=404)
    query = select(Space).where(
        Space.workspace_id == job.workspace_id,
        Space.status != "deleted",
        Space.deleted_at.is_(None),
        or_(Space.visibility == "shared", Space.owner_user_id == job.requested_by),
    )
    if represented_spaces is not None:
        query = query.where(in_ids(Space.id, represented_spaces))
    spaces = list(await db.scalars(query.order_by(Space.id).with_for_update(read=True, of=Space)))
    if represented_spaces is not None and {s.id for s in spaces} != set(represented_spaces):
        raise APIError(
            code="EXPORT_SCOPE_CHANGED",
            message="Export access changed. Create a new export.",
            status_code=409,
        )
    return spaces
