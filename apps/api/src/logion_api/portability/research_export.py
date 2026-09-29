"""Requester-scoped v0.3 records; never an AI context source."""

import re
from datetime import date
from typing import Any
from uuid import UUID

from sqlalchemy import Uuid, any_, literal, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.content.models import Attachment, Note, Resource
from logion_api.errors import APIError
from logion_api.execution.models import StudySession, Task
from logion_api.identity.models import User
from logion_api.knowledge.models import KnowledgeEdge
from logion_api.knowledge_space.models import KnowledgeCitation, SourceExcerpt
from logion_api.library.text_models import SourceText
from logion_api.memory.models import (
    KnowledgeSourceLink,
    MasteryRecord,
    QuizAttempt,
    QuizItem,
    ReviewSchedule,
    Topic,
    TopicDependency,
)
from logion_api.planning.models import (
    LearningGoal,
    LearningPlan,
    PlanPhase,
    PlanVersion,
    WeeklyReview,
)
from logion_api.portability.models import DataExportJob
from logion_api.research.models import ResearchClaim, ResearchIdea, ResearchQuestion
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership

RESEARCH_EXPORT_SCHEMA = "logion-export-v03"
COMMON_FIELDS = ["id", "space_id", "version", "created_at", "updated_at", "deleted_at"]
# Explicit columns keep future server/internal fields out of portable user data.
FIELDS: dict[type[Any], str] = {
    Space: "name visibility status kind archived_at",
    LearningGoal: "title description desired_outcome status weekly_minutes target_date",
    LearningPlan: "goal_id title status",
    PlanVersion: "plan_id version_number status change_summary published_at",
    PlanPhase: "plan_version_id title description position estimated_minutes "
    "acceptance_criteria archived_at",
    StudySession: "task_id status started_at ended_at manual_minutes reflection",
    Attachment: "target_type target_id filename declared_mime detected_mime size_bytes "
    "expected_sha256 verified_sha256 status verified_at",
    Resource: "task_id resource_type title source_url legacy_paper_id csl doi arxiv_id pmid "
    "citation_key tags zotero_library_id zotero_item_key zotero_attachment_version "
    "zotero_version zotero_sync_stopped zotero_collection_keys file_locator "
    "reading_status read_at pdf_filename page_count sha256 page_index",
    Note: "task_id note_kind resource_id title markdown_body",
    Topic: "title description",
    QuizItem: "topic_id resource_id origin ai_run_id prompt answer_key explanation evaluation_mode",
    Task: "goal_id phase_id resource_id reading_mode scheduled_on reading_completed_at title "
    "description status priority estimated_minutes planned_at due_at blocked_reason",
    SourceText: "resource_id file_sha256 text page_offsets extracted_by normalization_version",
    SourceExcerpt: "resource_id resource_version origin zotero_annotation_key "
    "zotero_annotation_version source_version_key source_file_sha256 "
    "source_version_sha256 excerpt_text excerpt_sha256 hash_algorithm "
    "normalization_version page_start page_end char_start char_end "
    "section_locator status stale_at",
    ResearchIdea: "title body status",
    ResearchQuestion: "question rationale status parent_id",
    ResearchClaim: "paper_id resource_id statement stance",
    QuizAttempt: "topic_id quiz_item_id ai_grade response_text is_correct confidence "
    "duration_seconds error_cause attempted_at",
    MasteryRecord: "topic_id suggested_level suggested_reason suggested_at "
    "confirmed_level confirmed_at",
    ReviewSchedule: "topic_id status source interval_days next_review_at last_reviewed_at",
    WeeklyReview: "week_start timezone stats task_snapshot triage ai_comment_run_id "
    "ai_comment closed_at",
    KnowledgeEdge: "from_resource_id from_claim_id from_idea_id to_resource_id to_topic_id "
    "to_question_id from_type from_id to_type to_id relation status origin reason "
    "evidence_excerpt_id ai_run_id decided_at",
    KnowledgeCitation: "source_excerpt_id relationship_kind relation_note topic_id quiz_item_id "
    "research_claim_id note_id accepted_draft_id accepted_at status closed_at close_reason",
    TopicDependency: "prerequisite_topic_id dependent_topic_id",
    KnowledgeSourceLink: "source_kind source_id target_kind target_id excerpt_sha256 "
    "excerpt_start excerpt_end source_version",
}


def record(row: Any) -> dict[str, Any]:
    values = {}
    for name in [*COMMON_FIELDS, *FIELDS[type(row)].split()]:
        if not hasattr(row, name):
            continue
        value = getattr(row, name)
        values[name] = (
            value.isoformat()
            if isinstance(value, date)
            else (str(value) if isinstance(value, UUID) else value)
        )
    return values


def in_ids(column: Any, values: list[UUID]) -> Any:
    # One typed array bind avoids PostgreSQL's parameter ceiling on large libraries.
    return column == any_(literal(values, type_=ARRAY(Uuid())))


async def require_export_access(
    db: AsyncSession,
    job: DataExportJob,
    represented_spaces: list[UUID] | None = None,
) -> list[Space]:
    # Account deletion locks User first. Membership changes lock Workspace first;
    # export then takes Space locks in UUID order, and never locks Membership.
    user = await db.scalar(
        select(User.id)
        .where(
            User.id == job.requested_by,
            User.status == "active",
            User.email_verified_at.is_not(None),
        )
        .with_for_update(read=True, of=User)
    )
    workspace = await db.scalar(
        select(Workspace.id)
        .where(
            Workspace.id == job.workspace_id,
            Workspace.status == "active",
            Workspace.deleted_at.is_(None),
        )
        .with_for_update(read=True, of=Workspace)
    )
    member = await db.scalar(
        select(WorkspaceMembership.id).where(
            WorkspaceMembership.workspace_id == job.workspace_id,
            WorkspaceMembership.user_id == job.requested_by,
            WorkspaceMembership.status == "active",
        )
    )
    if user is None or workspace is None or member is None:
        raise APIError(code="EXPORT_NOT_FOUND", message="Export not found.", status_code=404)
    query = select(Space).where(
        Space.workspace_id == job.workspace_id,
        Space.status != "deleted",
        Space.deleted_at.is_(None),
        or_(Space.visibility == "shared", Space.owner_user_id == job.requested_by),
    )
    if represented_spaces is not None:
        query = query.where(in_ids(Space.id, represented_spaces))
    spaces = list(await db.scalars(query.order_by(Space.id).with_for_update(read=True, of=Space)))
    if represented_spaces is not None and {s.id for s in spaces} != set(represented_spaces):
        raise APIError(
            code="EXPORT_SCOPE_CHANGED",
            message="Export access changed. Create a new export.",
            status_code=409,
        )
    return spaces


async def research_records(
    db: AsyncSession,
    job: DataExportJob,
) -> dict[str, list[dict[str, Any]]]:
    spaces = await require_export_access(db, job)
    space_ids = [row.id for row in spaces]
    objects: dict[str, list[dict[str, Any]]] = {"spaces": [record(row) for row in spaces]}

    def scoped(model: Any, *, include_deleted: bool = False) -> Any:
        query = select(model).where(
            model.workspace_id == job.workspace_id, in_ids(model.space_id, space_ids)
        )
        if hasattr(model, "deleted_at") and not include_deleted:
            query = query.where(model.deleted_at.is_(None))
        return query.order_by(model.id)

    async def save(model: Any, query: Any) -> None:
        objects[model.__tablename__] = [record(row) for row in await db.scalars(query)]

    def ids(model: Any) -> list[UUID]:
        return [UUID(row["id"]) for row in objects.get(model.__tablename__, [])]

    await save(LearningGoal, scoped(LearningGoal))
    await save(
        LearningPlan, scoped(LearningPlan).where(in_ids(LearningPlan.goal_id, ids(LearningGoal)))
    )
    await save(
        PlanVersion,
        select(PlanVersion)
        .where(
            PlanVersion.workspace_id == job.workspace_id,
            in_ids(PlanVersion.plan_id, ids(LearningPlan)),
        )
        .order_by(PlanVersion.id),
    )
    await save(
        PlanPhase,
        select(PlanPhase)
        .where(
            PlanPhase.workspace_id == job.workspace_id,
            in_ids(PlanPhase.plan_version_id, ids(PlanVersion)),
        )
        .order_by(PlanPhase.id),
    )
    for model in (Resource, Note, Topic, Task):
        await save(
            model,
            scoped(model).where(
                or_(model.research_owner_id.is_(None), model.research_owner_id == job.requested_by)
            ),
        )
    await save(StudySession, scoped(StudySession).where(in_ids(StudySession.task_id, ids(Task))))
    await save(
        Attachment,
        scoped(Attachment).where(
            or_(
                (Attachment.target_type == "resource")
                & in_ids(Attachment.target_id, ids(Resource)),
                (Attachment.target_type == "note") & in_ids(Attachment.target_id, ids(Note)),
                (Attachment.target_type == "task") & in_ids(Attachment.target_id, ids(Task)),
            )
        ),
    )
    # A retired question's prompt and grading evidence remain portable with its
    # retained attempts; retiring a question must not discard learning history.
    attempted = select(QuizAttempt.quiz_item_id).where(
        QuizAttempt.workspace_id == job.workspace_id,
        QuizAttempt.user_id == job.requested_by,
        QuizAttempt.deleted_at.is_(None),
    )
    await save(
        QuizItem,
        scoped(QuizItem, include_deleted=True).where(
            or_(
                QuizItem.research_owner_id.is_(None), QuizItem.research_owner_id == job.requested_by
            ),
            in_ids(QuizItem.topic_id, ids(Topic)),
            or_(QuizItem.deleted_at.is_(None), QuizItem.id.in_(attempted)),
        ),
    )
    for source_model in (SourceText, SourceExcerpt):
        await save(
            source_model,
            scoped(source_model).where(in_ids(source_model.resource_id, ids(Resource))),
        )
    for personal_model in (ResearchIdea, ResearchQuestion, ResearchClaim, WeeklyReview):
        await save(
            personal_model, scoped(personal_model).where(personal_model.user_id == job.requested_by)
        )
    for memory_model in (QuizAttempt, MasteryRecord, ReviewSchedule):
        query = scoped(memory_model).where(
            memory_model.user_id == job.requested_by, in_ids(memory_model.topic_id, ids(Topic))
        )
        if memory_model is QuizAttempt:
            query = query.where(in_ids(QuizAttempt.quiz_item_id, ids(QuizItem)))
        await save(memory_model, query)
    await save(
        TopicDependency,
        scoped(TopicDependency).where(
            in_ids(TopicDependency.prerequisite_topic_id, ids(Topic)),
            in_ids(TopicDependency.dependent_topic_id, ids(Topic)),
        ),
    )
    await save(
        KnowledgeSourceLink,
        scoped(KnowledgeSourceLink).where(
            KnowledgeSourceLink.source_kind == "note",
            in_ids(KnowledgeSourceLink.source_id, ids(Note)),
            or_(
                (KnowledgeSourceLink.target_kind == "topic")
                & in_ids(KnowledgeSourceLink.target_id, ids(Topic)),
                (KnowledgeSourceLink.target_kind == "quiz_item")
                & in_ids(KnowledgeSourceLink.target_id, ids(QuizItem)),
            ),
        ),
    )
    await save(
        KnowledgeCitation,
        scoped(KnowledgeCitation).where(
            in_ids(KnowledgeCitation.source_excerpt_id, ids(SourceExcerpt)),
            or_(
                in_ids(KnowledgeCitation.topic_id, ids(Topic)),
                in_ids(KnowledgeCitation.quiz_item_id, ids(QuizItem)),
                in_ids(KnowledgeCitation.note_id, ids(Note)),
                in_ids(KnowledgeCitation.research_claim_id, ids(ResearchClaim)),
            ),
        ),
    )
    # Edges are always requester-owned, including rejected suggestions and idea
    # links. Preserve their identifiers even when an original source is gone.
    await save(
        KnowledgeEdge, scoped(KnowledgeEdge).where(KnowledgeEdge.user_id == job.requested_by)
    )
    return objects


def bibliography(row: dict[str, Any]) -> str:
    def clean(value: Any) -> str:
        return " ".join(str(value or "").translate(str.maketrans("", "", "{}\\")).split())

    key = re.sub(r"[^A-Za-z0-9_:-]", "_", str(row.get("citation_key") or row["id"]))[:160]
    csl = row.get("csl") or {}
    authors = " and ".join(
        author.get("literal")
        or ", ".join(filter(None, (author.get("family"), author.get("given"))))
        for author in csl.get("author", [])
    )
    dates = (csl.get("issued") or {}).get("date-parts", [])
    values = {
        "title": row.get("title") or "Untitled",
        "author": authors,
        "year": dates[0][0] if dates and dates[0] else None,
        "journal": csl.get("container-title"),
        "volume": csl.get("volume"),
        "number": csl.get("issue"),
        "pages": csl.get("page"),
        "doi": row.get("doi"),
        "url": row.get("source_url"),
        "eprint": row.get("arxiv_id"),
    }
    fields = [f"  {name} = {{{clean(value)}}}" for name, value in values.items() if value]
    return "@misc{" + key + ",\n" + ",\n".join(fields) + "\n}"
