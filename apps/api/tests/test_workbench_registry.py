from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from logion_api.content.models import Note, Resource
from logion_api.db import session_factory
from logion_api.errors import APIError
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.execution.models import Task
from logion_api.identity.models import User
from logion_api.memory.models import Topic
from logion_api.planning.models import LearningGoal
from logion_api.research.models import PaperRecord, ResearchClaim
from logion_api.self_study.models import LearningTrack, StudyProject
from logion_api.workbenches.registry import WorkbenchTargetRegistry
from logion_api.workbenches.schemas import WorkbenchLinkMutableV1
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "table"),
    [
        ("task", "tasks"),
        ("source", "resources"),
        ("topic", "topics"),
        ("note", "notes"),
        ("evidence", "evidence_items"),
        ("claim", "research_claims"),
        ("project", "study_projects"),
    ],
)
async def test_registry_maps_each_kind_to_one_fixed_model(kind: str, table: str) -> None:
    db = cast(AsyncSession, AsyncMock(spec=AsyncSession))
    db.scalar.return_value = uuid4()  # type: ignore[attr-defined]
    mutable = WorkbenchLinkMutableV1.model_validate(
        {
            "target": {"kind": kind, "id": str(uuid4())},
            "position": 0,
            "attributes": {},
        }
    )

    assert await WorkbenchTargetRegistry().is_authorized(db, uuid4(), mutable.target)
    statement = db.scalar.await_args.args[0]  # type: ignore[attr-defined]
    assert table in str(statement)
    if kind == "source":
        assert "paper_records" not in str(statement)


@pytest.mark.asyncio
async def test_registry_returns_opaque_not_found_and_checks_nested_targets() -> None:
    db = cast(AsyncSession, AsyncMock(spec=AsyncSession))
    db.scalar.side_effect = [uuid4(), None]  # type: ignore[attr-defined]
    mutable = WorkbenchLinkMutableV1.model_validate(
        {
            "target": {"kind": "task", "id": str(uuid4())},
            "position": 0,
            "attributes": {"related": {"kind": "note", "id": str(uuid4())}},
        }
    )
    registry = WorkbenchTargetRegistry()

    assert not await registry.is_link_authorized(db, uuid4(), mutable)
    db.scalar.side_effect = [None]  # type: ignore[attr-defined]
    with pytest.raises(APIError) as raised:
        await registry.require_link_authorized(db, uuid4(), mutable)
    assert raised.value.code == "RESOURCE_NOT_FOUND"
    assert raised.value.details == {}


def test_registry_queries_do_not_accept_client_scope_or_dynamic_table_names() -> None:
    assert not hasattr(WorkbenchTargetRegistry, "register")
    assert not hasattr(WorkbenchTargetRegistry, "resolve_table")


def _target(kind: str, target_id: UUID) -> Any:
    return WorkbenchLinkMutableV1.model_validate(
        {
            "target": {"kind": kind, "id": str(target_id)},
            "position": 0,
            "attributes": {},
        }
    ).target


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_registry_authorizes_all_seven_fixed_kinds_and_denies_tombstones() -> None:
    owner_id, other_id = uuid4(), uuid4()
    workspace_id, space_id = uuid4(), uuid4()
    goal_id, task_id = uuid4(), uuid4()
    note_id, source_id, topic_id, evidence_id = uuid4(), uuid4(), uuid4(), uuid4()
    paper_id, claim_id, track_id, project_id = uuid4(), uuid4(), uuid4(), uuid4()
    async with session_factory() as db:
        db.add_all(
            (
                User(
                    id=owner_id,
                    email=f"registry-owner-{owner_id}@example.test",
                    email_normalized=f"registry-owner-{owner_id}@example.test",
                ),
                User(
                    id=other_id,
                    email=f"registry-other-{other_id}@example.test",
                    email_normalized=f"registry-other-{other_id}@example.test",
                ),
            )
        )
        await db.flush()
        db.add(Workspace(id=workspace_id, name="Registry", created_by=owner_id))
        await db.flush()
        db.add_all(
            (
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=owner_id,
                    role="owner",
                    status="active",
                ),
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=other_id,
                    role="viewer",
                    status="active",
                ),
                Space(
                    id=space_id,
                    workspace_id=workspace_id,
                    owner_user_id=owner_id,
                    name="Private",
                    visibility="private",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
            )
        )
        await db.flush()
        db.add_all(
            (
                LearningGoal(
                    id=goal_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    title="Goal",
                    desired_outcome="Done",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                Note(
                    id=note_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    title="Note",
                    yjs_state=b"",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                Resource(
                    id=source_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    resource_type="link",
                    title="Source",
                    source_url="https://example.test",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                Topic(
                    id=topic_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    title="Topic",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                PaperRecord(
                    id=paper_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    user_id=owner_id,
                    title="Paper",
                    citation_key="paper",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                LearningTrack(
                    id=track_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    user_id=owner_id,
                    title="Track",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
            )
        )
        await db.flush()
        db.add_all(
            (
                Task(
                    id=task_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    goal_id=goal_id,
                    title="Task",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                ResearchClaim(
                    id=claim_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    user_id=owner_id,
                    paper_id=paper_id,
                    statement="Claim",
                    stance="supports",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
                StudyProject(
                    id=project_id,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    user_id=owner_id,
                    track_id=track_id,
                    title="Project",
                    intended_outcome="Done",
                    created_by=owner_id,
                    updated_by=owner_id,
                ),
            )
        )
        await db.flush()
        db.add(
            EvidenceItem(
                id=evidence_id,
                workspace_id=workspace_id,
                space_id=space_id,
                task_id=task_id,
                evidence_type="text",
                summary="Evidence",
                created_by=owner_id,
                updated_by=owner_id,
            )
        )
        await db.commit()

    targets = {
        "task": task_id,
        "source": source_id,
        "topic": topic_id,
        "note": note_id,
        "evidence": evidence_id,
        "claim": claim_id,
        "project": project_id,
    }
    registry = WorkbenchTargetRegistry()
    async with session_factory() as db:
        for kind, target_id in targets.items():
            assert await registry.is_authorized(db, owner_id, _target(kind, target_id))
            assert not await registry.is_authorized(db, other_id, _target(kind, target_id))

        note = await db.get(Note, note_id)
        assert note is not None
        note.deleted_at = datetime.now(UTC)
        await db.flush()
        assert not await registry.is_authorized(db, owner_id, _target("note", note_id))
