from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.errors import APIError
from logion_api.users.models import UserSetting
from logion_api.users.schemas import UserSettingWrite


class UserSettingService:
    @staticmethod
    def version_conflict(keys: list[str]) -> APIError:
        return APIError(
            code="USER_SETTING_VERSION_CONFLICT",
            message="One or more user settings changed before this update.",
            status_code=409,
            details={"keys": sorted(keys)},
        )

    async def list_settings(
        self,
        db: AsyncSession,
        user_id: UUID,
        *,
        key: str | None = None,
    ) -> list[UserSetting]:
        query = select(UserSetting).where(UserSetting.user_id == user_id)
        if key is not None:
            query = query.where(UserSetting.key == key)
        return list((await db.scalars(query.order_by(UserSetting.key))).all())

    async def update(
        self,
        db: AsyncSession,
        user_id: UUID,
        updates: list[UserSettingWrite],
    ) -> list[UserSetting]:
        keys = [update.key for update in updates]
        existing = {
            setting.key: setting
            for setting in (
                await db.scalars(
                    select(UserSetting)
                    .where(UserSetting.user_id == user_id, UserSetting.key.in_(keys))
                    .with_for_update()
                )
            ).all()
        }
        conflicts = [
            update.key
            for update in updates
            if (
                (current := existing.get(update.key)) is None
                and update.version != 0
                or current is not None
                and current.version != update.version
            )
        ]
        if conflicts:
            raise self.version_conflict(conflicts)

        result: list[UserSetting] = []
        try:
            async with db.begin_nested():
                for update in updates:
                    current = existing.get(update.key)
                    if current is None:
                        current = UserSetting(
                            user_id=user_id,
                            key=update.key,
                            value=update.value,
                            version=1,
                        )
                        db.add(current)
                    else:
                        current.value = update.value
                        current.version += 1
                    result.append(current)
                await db.flush()
        except IntegrityError as exc:
            raise self.version_conflict(keys) from exc
        return sorted(result, key=lambda setting: setting.key)
