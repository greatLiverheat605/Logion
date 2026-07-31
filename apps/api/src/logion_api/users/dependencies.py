from typing import Annotated

from fastapi import Depends

from logion_api.users.settings import UserSettingService


def get_user_setting_service() -> UserSettingService:
    return UserSettingService()


UserSettingServiceDependency = Annotated[
    UserSettingService,
    Depends(get_user_setting_service),
]
