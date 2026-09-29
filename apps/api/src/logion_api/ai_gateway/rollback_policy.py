"""Old executors must leave research jobs for the forward application."""

from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from logion_api.ai_gateway.models import AIRun
from logion_api.content.models import Note, Resource
from logion_api.errors import APIError
from logion_api.execution.models import Task
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.memory.models import QuizAttempt, QuizItem, Topic

RESEARCH_TASKS = (
    "translate",
    "explain",
    "close_reading",
    "quiz_generate",
    "quiz_grade",
    "link_suggest",
    "weekly_comment",
)
PRIVATE_TYPES = ("idea", "ideas", "research_idea", "research_ideas")


def legacy_run_scope() -> ColumnElement[bool]:
    return and_(
        AIRun.context_entity_types == [],
        func.lower(AIRun.task_type).not_in(RESEARCH_TASKS),
        func.lower(AIRun.target_type).not_in(
            (*PRIVATE_TYPES, "weekly_review", "source_text", "knowledge_edge")
        ),
        AIRun.prompt_version == "structured-draft-v1",
        *(
            ~select(model.id)
            .where(model.id == AIRun.target_id, model.research_owner_id.is_not(None))
            .exists()
            for model in (Resource, Note, Topic, QuizItem, Task)
        ),
        ~select(SourceExcerpt.id)
        .join(Resource, Resource.id == SourceExcerpt.resource_id)
        .where(SourceExcerpt.id == AIRun.target_id, Resource.research_owner_id.is_not(None))
        .exists(),
        ~select(QuizAttempt.id)
        .join(Topic, Topic.id == QuizAttempt.topic_id)
        .where(QuizAttempt.id == AIRun.target_id, Topic.research_owner_id.is_not(None))
        .exists(),
    )


def require_legacy_task(task_type: str, target_type: str) -> None:
    if task_type.lower() in RESEARCH_TASKS or target_type.lower() in (
        *PRIVATE_TYPES,
        "weekly_review",
        "source_text",
        "knowledge_edge",
    ):
        raise APIError(
            code="AI_CONTEXT_FORBIDDEN",
            message="This AI task is unavailable during rollback.",
            status_code=403,
        )


async def require_legacy_run(db: AsyncSession, run_id: UUID) -> None:
    if await db.scalar(select(AIRun.id).where(AIRun.id == run_id, legacy_run_scope())) is None:
        raise APIError(
            code="AI_CONTEXT_FORBIDDEN",
            message="This AI task is unavailable during rollback.",
            status_code=403,
        )
