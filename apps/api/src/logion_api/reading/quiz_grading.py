"""The only AI side effect for a reading attempt is grading evidence, never mastery."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.ai_gateway.models import AIRun
from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.errors import APIError
from logion_api.library.service import not_found
from logion_api.memory.models import QuizAttempt, QuizItem, Topic
from logion_api.reading.quiz_types import parse_grade
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.permissions import ROLE_PERMISSIONS, Permission, WorkspaceRole


async def grading_attempt(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user_id: UUID,
    attempt_id: UUID,
    space_id: UUID | None = None,
    lock: bool = False,
) -> tuple[QuizAttempt, QuizItem]:
    query = (
        select(QuizAttempt, QuizItem)
        .join(QuizItem, QuizItem.id == QuizAttempt.quiz_item_id)
        .join(Topic, Topic.id == QuizItem.topic_id)
        .join(Resource, Resource.id == QuizItem.resource_id)
        .join(Space, Space.id == Resource.space_id)
        .join(Workspace, Workspace.id == Resource.workspace_id)
        .join(
            WorkspaceMembership,
            (WorkspaceMembership.workspace_id == workspace_id)
            & (WorkspaceMembership.user_id == user_id),
        )
        .where(
            QuizAttempt.id == attempt_id,
            QuizAttempt.workspace_id == workspace_id,
            QuizAttempt.user_id == user_id,
            QuizAttempt.deleted_at.is_(None),
            QuizAttempt.topic_id == QuizItem.topic_id,
            QuizAttempt.space_id == QuizItem.space_id,
            QuizItem.research_owner_id == user_id,
            QuizItem.deleted_at.is_(None),
            Topic.research_owner_id == user_id,
            Topic.deleted_at.is_(None),
            Resource.research_owner_id == user_id,
            Resource.deleted_at.is_(None),
            Space.status == "active",
            Workspace.status == "active",
            (Space.visibility == "shared") | (Space.owner_user_id == user_id),
            WorkspaceMembership.status == "active",
            WorkspaceMembership.role.in_(
                [
                    role.value
                    for role in WorkspaceRole
                    if Permission.AI_USE in ROLE_PERMISSIONS[role]
                ]
            ),
        )
    )
    if space_id is not None:
        query = query.where(QuizAttempt.space_id == space_id)
    if lock:
        query = query.with_for_update(of=QuizAttempt)
    pair = (await db.execute(query)).one_or_none()
    if pair is None:
        raise not_found()
    return pair[0], pair[1]


async def save_grading_evidence(db: AsyncSession, run: AIRun, output: dict[str, str]) -> None:
    if (
        run.target_type != "quiz_attempt"
        or run.expected_output_fields != ["grade"]
        or "quiz_attempt" not in run.context_entity_types
    ):
        raise APIError(
            code="AI_CONTEXT_TYPE_BLOCKED", message="Invalid grading context.", status_code=422
        )
    grade = parse_grade(output)
    attempt, _ = await grading_attempt(
        db,
        workspace_id=run.workspace_id,
        user_id=run.requested_by,
        attempt_id=run.target_id,
        lock=True,
    )
    if attempt.version != run.target_version or attempt.ai_grade is not None:
        raise APIError(
            code="RESOURCE_VERSION_CONFLICT",
            message="The attempt already changed.",
            status_code=409,
        )
    now = utc_now()
    attempt.ai_grade = {
        **grade.model_dump(),
        "ai_run_id": str(run.id),
        "graded_at": now.isoformat(),
    }
    attempt.version += 1
    attempt.updated_at = now
