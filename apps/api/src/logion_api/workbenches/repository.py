from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.identity.models import User
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
)


@dataclass(frozen=True)
class DefinitionCounts:
    active: int
    total: int


@dataclass(frozen=True)
class DefinitionCursor:
    snapshot_at: datetime
    updated_at: datetime
    definition_id: UUID


@dataclass(frozen=True)
class DefinitionPage:
    items: list[WorkbenchDefinition]
    next_cursor: DefinitionCursor | None


class WorkbenchRepository:
    async def lock_owner(self, db: AsyncSession, owner_user_id: UUID) -> bool:
        owner = await db.scalar(
            select(User.id).where(User.id == owner_user_id).with_for_update(of=User)
        )
        return owner is not None

    async def get_receipt(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        idempotency_key: UUID,
    ) -> WorkbenchIdempotencyReceipt | None:
        return cast(
            WorkbenchIdempotencyReceipt | None,
            await db.scalar(
                select(WorkbenchIdempotencyReceipt).where(
                    WorkbenchIdempotencyReceipt.owner_user_id == owner_user_id,
                    WorkbenchIdempotencyReceipt.idempotency_key == idempotency_key,
                )
            ),
        )

    async def get_definition(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        definition_id: UUID,
        *,
        for_update: bool = False,
    ) -> WorkbenchDefinition | None:
        statement = select(WorkbenchDefinition).where(
            WorkbenchDefinition.id == definition_id,
            WorkbenchDefinition.owner_user_id == owner_user_id,
        )
        if for_update:
            statement = statement.with_for_update(of=WorkbenchDefinition)
        return cast(WorkbenchDefinition | None, await db.scalar(statement))

    async def count_definitions(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
    ) -> DefinitionCounts:
        row = (
            await db.execute(
                select(
                    func.count(WorkbenchDefinition.id),
                    func.sum(case((WorkbenchDefinition.lifecycle == "active", 1), else_=0)),
                ).where(WorkbenchDefinition.owner_user_id == owner_user_id)
            )
        ).one()
        return DefinitionCounts(active=int(row[1] or 0), total=int(row[0] or 0))

    async def list_definitions(
        self,
        db: AsyncSession,
        owner_user_id: UUID,
        *,
        lifecycle: str | None,
        limit: int,
        snapshot_at: datetime,
        cursor: DefinitionCursor | None,
    ) -> DefinitionPage:
        filters = [
            WorkbenchDefinition.owner_user_id == owner_user_id,
            WorkbenchDefinition.updated_at <= snapshot_at,
        ]
        if lifecycle is not None:
            filters.append(WorkbenchDefinition.lifecycle == lifecycle)
        if cursor is not None:
            filters.append(
                or_(
                    WorkbenchDefinition.updated_at < cursor.updated_at,
                    and_(
                        WorkbenchDefinition.updated_at == cursor.updated_at,
                        WorkbenchDefinition.id < cursor.definition_id,
                    ),
                )
            )
        rows = list(
            (
                await db.scalars(
                    select(WorkbenchDefinition)
                    .where(*filters)
                    .order_by(
                        WorkbenchDefinition.updated_at.desc(),
                        WorkbenchDefinition.id.desc(),
                    )
                    .limit(limit + 1)
                )
            ).all()
        )
        items = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = items[-1]
            next_cursor = DefinitionCursor(
                snapshot_at=snapshot_at,
                updated_at=last.updated_at,
                definition_id=last.id,
            )
        return DefinitionPage(items=items, next_cursor=next_cursor)

    @staticmethod
    def add_definition(db: AsyncSession, definition: WorkbenchDefinition) -> None:
        db.add(definition)

    @staticmethod
    def add_receipt(db: AsyncSession, receipt: WorkbenchIdempotencyReceipt) -> None:
        db.add(receipt)
