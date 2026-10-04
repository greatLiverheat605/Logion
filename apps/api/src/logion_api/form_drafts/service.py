import json
from datetime import timedelta
from typing import Annotated, Any
from uuid import UUID

from fastapi import Header, Request
from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Resource
from logion_api.db import session_factory, utc_now
from logion_api.errors import APIError
from logion_api.form_drafts.models import FormDraft
from logion_api.form_drafts.schemas import FIELDS, DraftKind, DraftWrite
from logion_api.identity.audit import new_audit_event
from logion_api.identity.dependencies import AuthContextDependency, DatabaseSession
from logion_api.identity.models import AuthSession, User
from logion_api.identity.service import AuthContext
from logion_api.library.service import LibraryService, not_found
from logion_api.library.text_models import SourceText
from logion_api.memory.models import QuizItem, Topic
from logion_api.planning.models import LearningGoal, WeeklyReview
from logion_api.research.models import ResearchIdea, ResearchQuestion

NEW_TARGET = UUID(int=0)
SUBMISSIONS = {
    "research_library_create": "source_create",
    "research_library_update": "source_edit",
    "research_idea_create": "idea_create",
    "research_idea_update": "idea_edit",
    "research_question_tree_create": "question_create",
    "research_question_tree_update": "question_edit",
    "research_question_split": "question_split",
    "research_question_merge": "question_merge",
    "online_goal_create": "goal_create",
    "online_goal_update": "goal_edit",
    "online_goal_phases_update": "phase_edit",
    "online_memory_topic_create": "topic_create",
    "online_memory_topic_update": "topic_edit",
    "online_memory_quiz_create": "quiz_create",
    "online_memory_quiz_update": "quiz_edit",
    "online_memory_attempt_create": "memory_answer",
    "reading_quiz_attempt_create": "reading_answer",
    "research_weekly_review_close": "weekly_triage",
    "knowledge_edge_create": "edge_create",
    "research_ai_run_create": "reading_question",
}
TARGETS: dict[str, tuple[Any, str | None]] = {
    "source_edit": (Resource, "research_owner_id"),
    "idea_edit": (ResearchIdea, "user_id"),
    "question_create": (ResearchQuestion, "user_id"),
    "question_edit": (ResearchQuestion, "user_id"),
    "question_split": (ResearchQuestion, "user_id"),
    "goal_edit": (LearningGoal, None),
    "phase_edit": (LearningGoal, None),
    "topic_edit": (Topic, "research_owner_id"),
    "quiz_create": (Topic, "research_owner_id"),
    "quiz_edit": (QuizItem, "research_owner_id"),
    "memory_answer": (QuizItem, "research_owner_id"),
    "reading_answer": (QuizItem, "research_owner_id"),
    "weekly_triage": (WeeklyReview, "user_id"),
    "reading_question": (Resource, "research_owner_id"),
}


def conflict() -> APIError:
    return APIError(
        code="FORM_DRAFT_CONFLICT", message="Reload the changed draft.", status_code=409
    )


async def lock_user(db: AsyncSession, context: AuthContext) -> None:
    active = await db.scalar(
        select(User.id).where(User.id == context.user.id, User.status == "active").with_for_update()
    )
    session = await db.scalar(
        select(AuthSession.id).where(
            AuthSession.id == context.session.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.access_expires_at > utc_now(),
            AuthSession.refresh_expires_at > utc_now(),
        )
    )
    if active is None or session is None:
        raise APIError(code="AUTH_INVALID_SESSION", message="Sign in again.", status_code=401)


async def authorize_target(
    db: AsyncSession,
    library: LibraryService,
    context: AuthContext,
    workspace_id: UUID,
    space_id: UUID,
    kind: DraftKind,
    target: UUID,
    request_id: str,
    *,
    write: bool = False,
) -> None:
    await library.authorize(db, context, workspace_id, space_id, request_id, write=write)
    descriptor = TARGETS.get(kind)
    if target == NEW_TARGET:
        if descriptor and kind != "question_create":
            raise not_found()
        return
    if descriptor is None:
        raise not_found()
    model, owner = descriptor
    query = select(model.id).where(
        model.id == target,
        model.workspace_id == workspace_id,
        model.space_id == space_id,
        model.deleted_at.is_(None),
    )
    if owner:
        column = getattr(model, owner)
        own = column == context.user.id
        if model in (Topic, QuizItem) and kind != "reading_answer":
            own = own | column.is_(None)
        query = query.where(own)
    if model is WeeklyReview:
        query = query.where(WeeklyReview.closed_at.is_(None))
    if await db.scalar(query) is None:
        raise not_found()


def scoped(
    user: UUID, workspace: UUID, space: UUID, kind: DraftKind, target: UUID
) -> Select[tuple[FormDraft]]:
    return select(FormDraft).where(
        FormDraft.user_id == user,
        FormDraft.workspace_id == workspace,
        FormDraft.space_id == space,
        FormDraft.form_kind == kind,
        FormDraft.target_key == target,
    )


def audit(db: AsyncSession, user: UUID, request_id: str, kind: str, action: str) -> None:
    db.add(
        new_audit_event(
            request_id=request_id,
            event_type=f"form_draft.{action}",
            result="success",
            actor_id=user,
            metadata={"form_kind": kind},
        )
    )


async def save(
    db: AsyncSession,
    context: AuthContext,
    workspace: UUID,
    space: UUID,
    kind: DraftKind,
    target: UUID,
    payload: DraftWrite,
    request_id: str,
) -> FormDraft:
    limits = FIELDS[kind]
    try:
        size = len(json.dumps(payload.fields, ensure_ascii=False).encode("utf-8"))
    except UnicodeError:
        size = 4194305
    if (
        not payload.fields
        or any(
            key not in limits or len(value) > limits[key] or "\x00" in value
            for key, value in payload.fields.items()
        )
        or size > 4194304
    ):
        raise APIError(
            code="FORM_DRAFT_INVALID",
            message="Draft fields exceed the allowed form.",
            status_code=422,
        )
    row = await db.scalar(scoped(context.user.id, workspace, space, kind, target).with_for_update())
    now = utc_now()
    if row and row.expires_at <= now:
        await db.delete(row)
        await db.flush()
        row = None
    if (row.version if row else 0) != payload.expected_version or (
        row.id if row else None
    ) != payload.expected_id:
        raise conflict()
    if row is None:
        # The user lock serializes creation, quota and sign-out without extra coordination state.
        await db.execute(
            delete(FormDraft).where(
                FormDraft.user_id == context.user.id, FormDraft.expires_at <= now
            )
        )
        count = await db.scalar(
            select(func.count()).select_from(FormDraft).where(FormDraft.user_id == context.user.id)
        )
        if (count or 0) >= 20:
            raise APIError(
                code="FORM_DRAFT_QUOTA", message="Discard an existing draft first.", status_code=409
            )
        row = FormDraft(
            user_id=context.user.id,
            workspace_id=workspace,
            space_id=space,
            form_kind=kind,
            target_key=target,
            fields=payload.fields,
            version=1,
            updated_at=now,
            expires_at=now + timedelta(days=7),
        )
        db.add(row)
    else:
        row.fields, row.updated_at, row.expires_at = payload.fields, now, now + timedelta(days=7)
        row.version += 1
    audit(db, context.user.id, request_id, kind, "saved")
    await db.flush()
    return row


async def prepare_submission(
    request: Request,
    db: DatabaseSession,
    context: AuthContextDependency,
    x_logion_form_draft: Annotated[
        str | None, Header(max_length=80, pattern=r"^[0-9a-fA-F-]{36}:[1-9][0-9]{0,18}$")
    ] = None,
) -> None:
    if x_logion_form_draft is None:
        return
    kind = SUBMISSIONS.get(getattr(request.scope.get("route"), "operation_id", ""))
    if request.method not in {"POST", "PUT", "PATCH"} or kind is None:
        raise conflict()
    await lock_user(db, context)
    try:
        identifier, version = x_logion_form_draft.split(":")
        row = await db.scalar(
            select(FormDraft)
            .where(
                FormDraft.id == UUID(identifier),
                FormDraft.user_id == context.user.id,
                FormDraft.form_kind == kind,
                FormDraft.workspace_id == UUID(str(request.path_params["workspace_id"])),
                FormDraft.space_id == UUID(str(request.path_params["space_id"])),
                FormDraft.version == int(version),
                FormDraft.expires_at > utc_now(),
            )
            .with_for_update()
        )
    except (ValueError, KeyError) as error:
        raise conflict() from error
    if row is None:
        raise conflict()
    target_param = {
        "source_edit": "resource_id",
        "idea_edit": "idea_id",
        "question_edit": "question_id",
        "question_split": "question_id",
        "goal_edit": "goal_id",
        "phase_edit": "goal_id",
        "topic_edit": "topic_id",
        "quiz_edit": "quiz_id",
        "memory_answer": "quiz_id",
        "reading_answer": "item_id",
        "weekly_triage": "review_id",
    }.get(kind)
    if target_param and str(row.target_key) != str(request.path_params.get(target_param)):
        raise conflict()
    if kind in {"quiz_create", "question_create"}:
        body = await request.json()
        if not isinstance(body, dict):
            raise conflict()
        key = "topic_id" if kind == "quiz_create" else "parent_id"
        if (kind == "quiz_create" or row.target_key != NEW_TARGET) and str(row.target_key) != str(
            body.get(key)
        ):
            raise conflict()
    if kind == "reading_question":
        # The draft belongs to the paper, while the request targets its extracted text.
        body = await request.json()
        if not isinstance(body, dict):
            raise conflict()
        target = body.get("target") or {}
        if not isinstance(target, dict):
            raise conflict()
        try:
            source_id = UUID(str(target.get("id")))
        except ValueError as error:
            raise conflict() from error
        if (
            target.get("entity_type") != "source_text"
            or not body.get("question")
            or (await db.scalar(select(SourceText.resource_id).where(SourceText.id == source_id)))
            != row.target_key
        ):
            raise conflict()
    db.info["form_draft_submission"] = (row, str(request.state.request_id))


async def consume(db: AsyncSession) -> None:
    pending = db.info.pop("form_draft_submission", None)
    if pending is None:
        return
    row, request_id = pending
    audit(db, row.user_id, request_id, row.form_kind, "submitted")
    await db.delete(row)


async def cleanup_expired() -> bool:
    async with session_factory() as db:
        expired = (
            select(FormDraft.id)
            .where(FormDraft.expires_at <= utc_now())
            .order_by(FormDraft.expires_at)
            .limit(100)
            .with_for_update(skip_locked=True)
        )
        removed = list(
            await db.scalars(
                delete(FormDraft).where(FormDraft.id.in_(expired)).returning(FormDraft.id)
            )
        )
        await db.commit()
        return bool(removed)
