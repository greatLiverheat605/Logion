"""Typed v0.3 preferences in the existing versioned user settings store."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator

from logion_api.errors import APIError

RESEARCH_SETTING_KEYS = frozenset(
    {
        "workbench.context",
        "workbench.layouts",
        "appearance.theme",
        "reader.selection_menu",
        "reader.hint_dismissed",
    }
)


class StrictPreference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ResearchContext(StrictPreference):
    workspace_id: UUID
    space_id: UUID


class PanePreference(StrictPreference):
    content: Literal[
        "info",
        "document",
        "translation",
        "quiz",
        "pdf",
        "outline",
        "thumbs",
        "note",
        "excerpts",
        "chat",
        "translate",
        "graphlocal",
    ]
    width: float = Field(ge=10, le=80, allow_inf_nan=False)
    collapsed: bool


class LayoutPreference(StrictPreference):
    preset: Literal["reading", "translation", "quiz", "focus", "custom"]
    panes: list[PanePreference] = Field(min_length=3, max_length=3)
    toolbars: bool

    @model_validator(mode="after")
    def retains_visible_pane(self) -> "LayoutPreference":
        if all(pane.collapsed for pane in self.panes):
            raise ValueError("At least one pane must remain visible")
        return self


def require_research_settings_enabled(enabled: bool, keys: list[str]) -> None:
    if not enabled and RESEARCH_SETTING_KEYS.intersection(keys):
        raise APIError(code="NOT_FOUND", message="Not found.", status_code=404)


def validate_research_preference(key: str, value: str) -> ResearchContext | None:
    try:
        if key == "workbench.context":
            return ResearchContext.model_validate_json(value)
        if key == "workbench.layouts":
            LayoutPreference.model_validate_json(value)
        elif key == "appearance.theme":
            TypeAdapter(Literal["light", "dark", "system"]).validate_json(value, strict=True)
        elif key in {"reader.selection_menu", "reader.hint_dismissed"}:
            TypeAdapter(bool).validate_json(value, strict=True)
    except ValidationError as exc:
        raise APIError(
            code="RESEARCH_PREFERENCE_INVALID",
            message="The research preference is invalid.",
            status_code=422,
            details={"key": key},
        ) from exc
    return None
