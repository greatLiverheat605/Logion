from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

SettingKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=128,
        pattern=r"^[a-z][a-z0-9_.-]*$",
    ),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UserSettingWrite(Strict):
    key: SettingKey
    value: str = Field(max_length=8192)
    version: int = Field(ge=0)


class UserSettingBatchUpdate(Strict):
    settings: list[UserSettingWrite] = Field(min_length=1, max_length=50)

    @field_validator("settings")
    @classmethod
    def keys_are_unique(cls, settings: list[UserSettingWrite]) -> list[UserSettingWrite]:
        keys = [setting.key for setting in settings]
        if len(keys) != len(set(keys)):
            raise ValueError("setting keys must be unique")
        return settings


class UserSettingResponse(Strict):
    key: str
    value: str
    version: int


class UserSettingListResponse(Strict):
    settings: list[UserSettingResponse]
