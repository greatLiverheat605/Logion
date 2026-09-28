"""Server-owned research context selection; private ideas have no loader here."""

import json
from collections.abc import Iterable
from types import MappingProxyType
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.run_schemas import ObjectType
from logion_api.content.models import Note, Resource
from logion_api.errors import APIError
from logion_api.identity.audit import new_audit_event
from logion_api.identity.models import AuditEvent
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.library.text_models import SourceText
from logion_api.memory.models import QuizAttempt, Topic
from logion_api.reading.quiz_grading import grading_attempt
from logion_api.reading.selections import selected_text
from logion_api.research.models import ResearchClaim, ResearchQuestion

RESEARCH_TASK_TIERS = MappingProxyType(
    {
        "translate": "economical",
        "explain": "quality",
        "close_reading": "quality",
        "quiz_generate": "quality",
        "quiz_grade": "quality",
        "link_suggest": "quality",
        "weekly_comment": "economical",
    }
)
AI_CONTEXT_ENTITY_TYPES = frozenset(
    {
        "resource",
        "source_text",
        "source_excerpt",
        "note",
        "research_question",
        "topic",
        "research_claim",
    }
)
TASK_CONTEXT_ALLOWLIST = MappingProxyType(
    {
        task: frozenset({"quiz_attempt", "source_excerpt"})
        if task == "quiz_grade"
        else AI_CONTEXT_ENTITY_TYPES
        for task in RESEARCH_TASK_TIERS
    }
)
CONTEXT_MODELS = MappingProxyType(
    {
        "resource": Resource,
        "quiz_attempt": QuizAttempt,
        "source_text": SourceText,
        "note": Note,
        "source_excerpt": SourceExcerpt,
        "research_question": ResearchQuestion,
        "topic": Topic,
        "research_claim": ResearchClaim,
    }
)


class ContextEntity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entity_type: ObjectType
    id: UUID
    version: int = Field(ge=1)
    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def selection_shape(self) -> "ContextEntity":
        if (self.char_start is not None or self.char_end is not None) and (
            self.entity_type != "source_text"
            or self.char_start is None
            or self.char_end is None
            or self.char_end <= self.char_start
        ):
            raise ValueError("Only source_text accepts a complete character range")
        return self


def check_private_entities(entity_types: Iterable[str]) -> None:
    # Deliberately independent of the context allowlist: widening a builder cannot admit ideas.
    blocked = sorted(
        {
            kind
            for kind in entity_types
            if kind.lower() in {"idea", "ideas", "research_idea", "research_ideas"}
        }
    )
    if blocked:
        raise APIError(
            code="AI_PRIVATE_CONTENT_BLOCKED",
            message="Private ideas cannot be sent to AI.",
            status_code=403,
            details={"entity_types": blocked},
        )


def privacy_audit(
    actor_id: UUID, task_type: str, entity_types: Iterable[str], request_id: str
) -> AuditEvent:
    return new_audit_event(
        request_id=request_id,
        event_type="ai.private_content_blocked",
        result="denied",
        actor_id=actor_id,
        metadata={"task_type": task_type, "entity_types": sorted(set(entity_types))},
    )


async def build_research_context(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    space_id: UUID,
    user_id: UUID,
    task_type: str,
    entities: list[ContextEntity],
) -> dict[str, str]:
    kinds = [ref.entity_type for ref in entities]
    check_private_entities(kinds)
    allowed = TASK_CONTEXT_ALLOWLIST.get(task_type, frozenset())
    if any(kind not in allowed for kind in kinds):
        raise APIError(
            code="AI_CONTEXT_TYPE_BLOCKED",
            message="Context entity type is not allowed.",
            status_code=422,
        )
    fields: dict[str, str] = {}
    grading_resource_id: UUID | None = None
    if task_type == "quiz_grade":
        if (
            not entities
            or entities[0].entity_type != "quiz_attempt"
            or any(ref.entity_type != "source_excerpt" for ref in entities[1:])
        ):
            raise APIError(
                code="AI_CONTEXT_TYPE_BLOCKED",
                message="Grading needs an attempt and source excerpts.",
                status_code=422,
            )
        _, quiz = await grading_attempt(
            db,
            workspace_id=workspace_id,
            space_id=space_id,
            user_id=user_id,
            attempt_id=entities[0].id,
        )
        grading_resource_id = quiz.resource_id
    for index, ref in enumerate(entities):
        if ref.entity_type == "quiz_attempt":
            attempt, quiz = await grading_attempt(
                db, workspace_id=workspace_id, space_id=space_id, user_id=user_id, attempt_id=ref.id
            )
            if attempt.version != ref.version or attempt.ai_grade is not None:
                raise APIError(
                    code="RESOURCE_VERSION_CONFLICT",
                    message="The attempt changed or is graded.",
                    status_code=409,
                )
            fields[f"source_{index}"] = json.dumps(
                {
                    "entity_type": "quiz_attempt",
                    "data": {
                        "question": quiz.prompt,
                        "answer_key": quiz.answer_key,
                        "response": attempt.response_text,
                    },
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            continue
        model: Any = CONTEXT_MODELS.get(ref.entity_type)
        if model is None:
            raise APIError(
                code="AI_CONTEXT_UNAVAILABLE",
                message="This context source is not available yet.",
                status_code=422,
            )
        query = select(model).where(
            model.id == ref.id,
            model.workspace_id == workspace_id,
            model.space_id == space_id,
            model.deleted_at.is_(None),
        )
        if model in (ResearchQuestion, ResearchClaim):
            query = query.where(model.user_id == user_id)
        elif model in (Resource, Topic, Note):
            query = query.where(
                (model.research_owner_id.is_(None)) | (model.research_owner_id == user_id)
            )
            if model is Note:
                query = query.where(
                    Note.research_owner_id.is_(None)
                    | Note.resource_id.in_(
                        select(Resource.id).where(
                            Resource.research_owner_id == user_id,
                            Resource.deleted_at.is_(None),
                        )
                    )
                )
        elif model is SourceText:
            query = query.join(Resource, Resource.id == SourceText.resource_id).where(
                Resource.research_owner_id == user_id,
                Resource.deleted_at.is_(None),
                Resource.sha256 == SourceText.file_sha256,
            )
        elif model is SourceExcerpt:
            query = query.join(Resource, Resource.id == SourceExcerpt.resource_id).where(
                SourceExcerpt.status == "active",
                Resource.deleted_at.is_(None),
                (Resource.research_owner_id.is_(None)) | (Resource.research_owner_id == user_id),
            )
        if grading_resource_id is not None:
            query = query.where(SourceExcerpt.resource_id == grading_resource_id)
        item = await db.scalar(query)
        if item is None:
            raise APIError(
                code="RESOURCE_NOT_FOUND", message="Context source not found.", status_code=404
            )
        if item.version != ref.version:
            raise APIError(
                code="RESOURCE_VERSION_CONFLICT", message="Context source changed.", status_code=409
            )
        names = {
            "resource": (
                "title",
                "resource_type",
                "csl",
                "doi",
                "arxiv_id",
                "pmid",
                "citation_key",
            ),
            "note": ("title", "markdown_body"),
            "source_excerpt": ("excerpt_text",),
            "source_text": ("text", "page_offsets", "normalization_version"),
            "research_question": ("question", "rationale"),
            "topic": ("title", "description"),
            "research_claim": ("statement", "stance"),
        }[ref.entity_type]
        data = {key: getattr(item, key) for key in names}
        if ref.char_start is not None and ref.char_end is not None:
            data = {
                "text": selected_text(item, ref.char_start, ref.char_end),
                "char_start": ref.char_start,
                "char_end": ref.char_end,
                "normalization_version": item.normalization_version,
            }
        value = json.dumps(
            {
                "entity_type": ref.entity_type,
                "data": data,
                **({"ref": ref.model_dump(mode="json")} if task_type == "link_suggest" else {}),
            },
            ensure_ascii=False,
            sort_keys=True,
        )
        if len(value) > 100000:
            raise APIError(
                code="AI_RUN_INPUT_TOO_LARGE",
                message="The selected AI input is too large.",
                status_code=422,
            )
        fields[f"source_{index}"] = value
    return fields
