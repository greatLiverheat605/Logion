from typing import Literal
from uuid import UUID

from pydantic import Field

from logion_api.memory.schemas import (
    ErrorPatternResponse,
    QuizAttemptResponse,
    QuizItemResponse,
    QuizItemUpdateRequest,
    StrictModel,
    TopicCreateRequest,
    TopicDependencyResponse,
    TopicResponse,
)


class OnlineTopicPage(StrictModel):
    topics: list[TopicResponse]
    next_cursor: UUID | None
    can_edit: bool


class OnlineTopicDetail(StrictModel):
    topic: TopicResponse
    can_edit: bool
    error_patterns: list[ErrorPatternResponse]


class OnlineTopicUpdate(TopicCreateRequest):
    expected_version: int = Field(ge=1)


class OnlineQuizUpdate(QuizItemUpdateRequest):
    expected_version: int = Field(ge=1)


class OnlineRecallItem(QuizItemResponse):
    has_attempts: bool


class OnlineRecallPage(StrictModel):
    quiz_items: list[OnlineRecallItem]
    next_cursor: UUID | None


class OnlineAttemptPage(StrictModel):
    attempts: list[QuizAttemptResponse]
    next_cursor: UUID | None


class OnlineMemoryDelete(StrictModel):
    expected_version: int = Field(ge=1)


class OnlineNoteSource(StrictModel):
    id: UUID
    note_id: UUID
    note_title: str | None
    state: Literal["valid", "modified", "deleted", "unavailable"]
    start: int | None = None
    end: int | None = None


class OnlineSourcePage(StrictModel):
    sources: list[OnlineNoteSource]
    next_cursor: UUID | None


class OnlineDependencyPage(StrictModel):
    dependencies: list[TopicDependencyResponse]
    next_cursor: UUID | None
