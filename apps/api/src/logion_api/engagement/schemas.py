from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Category = Literal["learning", "collaboration", "sync", "security", "ai", "billing", "system"]
SearchType = Literal["goal", "task", "note", "resource", "paper"]


def default_search_types() -> list[SearchType]:
    return ["goal", "task", "note", "resource", "paper"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchRequest(Strict):
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    object_types: list[SearchType] = Field(
        default_factory=default_search_types,
        min_length=1,
        max_length=5,
    )
    limit: int = Field(default=30, ge=1, le=50)

    @field_validator("object_types")
    @classmethod
    def types_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("object_types must be unique")
        return value


class SearchResult(Strict):
    object_type: SearchType
    object_id: UUID
    workspace_id: UUID
    space_id: UUID
    title: str
    snippet: str
    permission_source: Literal["private_owner", "shared_space", "personal_record"]
    updated_at: datetime


class SearchResponse(Strict):
    results: list[SearchResult]


class NotificationPreferenceUpdate(Strict):
    expected_version: int | None = Field(default=None, ge=1)
    enabled_categories: list[Category] = Field(min_length=1, max_length=7)
    timezone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    quiet_start_minute: int | None = Field(default=None, ge=0, le=1439)
    quiet_end_minute: int | None = Field(default=None, ge=0, le=1439)

    @model_validator(mode="after")
    def validate_preferences(self) -> "NotificationPreferenceUpdate":
        if "security" not in self.enabled_categories:
            raise ValueError("security notifications cannot be disabled")
        if len(set(self.enabled_categories)) != len(self.enabled_categories):
            raise ValueError("enabled_categories must be unique")
        if (self.quiet_start_minute is None) != (self.quiet_end_minute is None):
            raise ValueError("quiet time requires both start and end")
        return self


class NotificationPreferenceResponse(Strict):
    workspace_id: UUID
    user_id: UUID
    enabled_categories: list[Category]
    timezone: str
    quiet_start_minute: int | None
    quiet_end_minute: int | None
    version: int


class NotificationResponse(Strict):
    id: UUID
    workspace_id: UUID
    category: Category
    title: str
    summary: str
    target_type: str | None
    target_id: UUID | None
    read_at: datetime | None
    created_at: datetime


class NotificationList(Strict):
    notifications: list[NotificationResponse]


class NotificationRead(Strict):
    read: Literal[True] = True


class CalendarFeedCreate(Strict):
    id: UUID
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class CalendarFeedResponse(Strict):
    id: UUID
    workspace_id: UUID
    name: str
    status: Literal["active", "revoked"]
    version: int
    created_at: datetime


class CalendarFeedCreated(CalendarFeedResponse):
    token: str


class CalendarFeedList(Strict):
    feeds: list[CalendarFeedResponse]


class CalendarFeedRevoke(Strict):
    expected_version: int = Field(ge=1)
