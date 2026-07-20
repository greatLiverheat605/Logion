import asyncio
import sys
from datetime import UTC, datetime
from uuid import UUID

from logion_api.db import engine, session_factory
from logion_api.identity.models import User
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from sqlalchemy import select

BACKFILL_USER_ID = UUID("0190f2a0-0000-7000-8000-000000000005")


async def seed_pre_workspace_user() -> None:
    now = datetime.now(UTC)
    async with engine.begin() as connection:
        await connection.execute(
            User.__table__.insert().values(
                id=BACKFILL_USER_ID,
                email="workspace-backfill@example.com",
                email_normalized="workspace-backfill@example.com",
                status="active",
                version=1,
                created_at=now,
                updated_at=now,
            )
        )


async def verify_backfill() -> None:
    async with session_factory() as session:
        result = await session.execute(
            select(Workspace, WorkspaceMembership, Space)
            .join(
                WorkspaceMembership,
                WorkspaceMembership.workspace_id == Workspace.id,
            )
            .join(Space, Space.workspace_id == Workspace.id)
            .where(
                Workspace.created_by == BACKFILL_USER_ID,
                WorkspaceMembership.user_id == BACKFILL_USER_ID,
                WorkspaceMembership.role == "owner",
                WorkspaceMembership.status == "active",
                Space.owner_user_id == BACKFILL_USER_ID,
                Space.visibility == "private",
                Space.status == "active",
            )
        )
        rows = result.all()
    if len(rows) != 1:
        raise RuntimeError(f"expected one backfilled tenant boundary, found {len(rows)}")


async def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in {"seed", "verify"}:
        raise SystemExit("usage: verify-workspace-backfill.py seed|verify")
    if sys.argv[1] == "seed":
        await seed_pre_workspace_user()
    else:
        await verify_backfill()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
