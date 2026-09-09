import asyncio
import base64
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Note, Resource
from logion_api.content.yjs_documents import state_from_markdown
from logion_api.db import session_factory
from logion_api.execution.evidence_models import EvidenceItem
from logion_api.execution.models import StudySession, Task
from logion_api.identity.models import AuditEvent, User
from logion_api.knowledge_space.models import KnowledgeCitation, SourceExcerpt
from logion_api.main import app
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.sync.models import ProcessedSyncOperation, SyncChange, WorkspaceSyncState
from logion_api.sync.push import SyncPushService, canonical_hash
from logion_api.sync.service import SyncLedgerError
from logion_api.workspaces.models import Space, WorkspaceMembership
from sqlalchemy import func, select

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture(loop_scope="session")
async def deletion_case():
    address = uuid4().hex
    client_ip = f"2001:db8::{address[:4]}:{address[4:8]}"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(client_ip, 54005)),
        base_url="http://test",
        headers={"Origin": "http://test", "X-Logion-Sync-Capabilities": "entity-deletion-v1"},
    ) as client:
        email = f"delete-{uuid4()}@example.com"
        password = f"delete-test-{uuid4()}"
        registered = await client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "device_name": "Delete A"},
        )
        assert registered.status_code == 201, registered.text
        workspace = (await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (await client.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"][0][
            "id"
        ]
        device = next(
            item["id"]
            for item in (await client.get("/api/v1/auth/devices")).json()["devices"]
            if item["current"]
        )
        envelope = {"protocol_version": "sync-v1", "workspace_id": workspace, "device_id": device}
        bootstrap = await client.post(
            f"/api/v1/workspaces/{workspace}/sync/bootstrap",
            json={
                **envelope,
                "message_type": "bootstrap_request",
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            },
        )
        assert bootstrap.status_code == 200, bootstrap.text
        epoch = bootstrap.json()["sync_epoch"]
        ids = {
            kind: uuid4() for kind in ("learning_goal", "task", "note", "resource", "study_session")
        }
        async with session_factory() as db:
            user = await db.scalar(select(User).where(User.email == email))
            common = {
                "workspace_id": UUID(workspace),
                "space_id": UUID(space),
                "created_by": user.id,
                "updated_by": user.id,
            }
            db.add(
                LearningGoal(
                    id=ids["learning_goal"],
                    title="Delete goal",
                    desired_outcome="Artifact",
                    **common,
                )
            )
            await db.flush()
            plan = LearningPlan(
                goal_id=ids["learning_goal"],
                title="Plan",
                workspace_id=UUID(workspace),
                space_id=UUID(space),
                created_by=user.id,
            )
            db.add(plan)
            await db.flush()
            version = PlanVersion(plan_id=plan.id, workspace_id=UUID(workspace), created_by=user.id)
            db.add(version)
            await db.flush()
            db.add(
                PlanPhase(
                    plan_version_id=version.id,
                    workspace_id=UUID(workspace),
                    title="Phase",
                    position=0,
                    estimated_minutes=30,
                    acceptance_criteria=["Proof"],
                )
            )
            db.add(
                Task(id=ids["task"], goal_id=ids["learning_goal"], title="Delete task", **common)
            )
            await db.flush()
            db.add(
                Note(
                    id=ids["note"],
                    task_id=ids["task"],
                    title="Private note",
                    markdown_body="Retained secret body",
                    yjs_state=state_from_markdown("Retained secret body"),
                    **common,
                )
            )
            db.add(
                Resource(
                    id=ids["resource"],
                    task_id=ids["task"],
                    title="Resource",
                    resource_type="link",
                    source_url="https://example.com",
                    **common,
                )
            )
            db.add(StudySession(id=ids["study_session"], task_id=ids["task"], **common))
            await db.commit()

        def operation(
            kind, entity_id=None, payload=None, base=1, operation_type="delete", dependencies=None
        ):
            body = payload or {}
            return {
                **envelope,
                "operation_id": str(uuid4()),
                "entity_type": kind,
                "entity_id": str(entity_id or ids[kind]),
                "operation_type": operation_type,
                "base_version": base,
                "client_occurred_at": datetime.now(UTC).isoformat(),
                "payload": body,
                "payload_hash": canonical_hash(body),
                "dependencies": dependencies or [],
            }

        async def push(op):
            response = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/push",
                headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
                json={
                    **envelope,
                    "message_type": "push_request",
                    "sync_epoch": epoch,
                    "operations": [op],
                },
            )
            assert response.status_code == 200, response.text
            return response.json()["results"][0]

        yield {
            "client": client,
            "workspace": workspace,
            "space": space,
            "ids": ids,
            "common": common,
            "operation": operation,
            "push": push,
            "envelope": envelope,
            "epoch": epoch,
            "email": email,
            "password": password,
        }


async def add_reference(case, kind, active=True):
    async with session_factory() as db:
        common = case["common"]
        now = datetime.now(UTC)
        if kind == "evidence":
            row = EvidenceItem(
                task_id=case["ids"]["task"],
                note_id=case["ids"]["note"],
                evidence_type="note",
                summary="Evidence summary",
                deleted_at=None if active else now,
                **common,
            )
        else:
            excerpt = SourceExcerpt(
                resource_id=case["ids"]["resource"],
                resource_version=1,
                source_version_key="test-v1",
                source_version_sha256="a" * 64,
                excerpt_text="source",
                excerpt_sha256="b" * 64,
                section_locator="Section",
                **common,
            )
            db.add(excerpt)
            await db.flush()
            row = KnowledgeCitation(
                workspace_id=common["workspace_id"],
                space_id=common["space_id"],
                source_excerpt_id=excerpt.id,
                note_id=case["ids"]["note"],
                relationship_kind="source",
                acceptance_operation_id=uuid4(),
                accepted_by=common["created_by"],
                accepted_at=now,
                created_by=common["created_by"],
                status="active" if active else "closed",
                closed_by=None if active else common["created_by"],
                closed_at=None if active else now,
                close_reason=None if active else "user_withdrawn",
            )
        db.add(row)
        await db.commit()
        return row.id


async def snapshot(case):
    async with session_factory() as db:
        values = []
        for model in (LearningGoal, Task, Note, Resource, StudySession):
            row = await db.scalar(
                select(model).where(model.workspace_id == UUID(case["workspace"]))
            )
            values.append((row.id, row.version, row.deleted_at, getattr(row, "task_id", None)))
        for model in (SyncChange, ProcessedSyncOperation, AuditEvent):
            values.append(
                await db.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.workspace_id == UUID(case["workspace"]))
                )
            )
        state = await db.get(WorkspaceSyncState, UUID(case["workspace"]))
        values.append(state.last_sequence)
        return values


@pytest.mark.parametrize("root", ["note", "task", "learning_goal"])
@pytest.mark.parametrize("reference", ["evidence", "citation"])
async def test_active_reference_refuses_entire_operation_without_writes(
    deletion_case, root, reference
):
    case = deletion_case
    await add_reference(case, reference)
    before = await snapshot(case)
    preview = await case["client"].get(
        f"/api/v1/workspaces/{case['workspace']}/sync/deletion-preview/{root}/{case['ids'][root]}"
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["can_delete"] is False
    result = await case["push"](case["operation"](root))
    assert result["status"] == "rejected"
    assert result["error_code"] == "SYNC_DELETE_BLOCKED_BY_REFERENCE"
    assert result["retryable"] is False
    assert result["details"] == {
        "evidence_count": int(reference == "evidence"),
        "citation_count": int(reference == "citation"),
    }
    assert await snapshot(case) == before


@pytest.mark.parametrize("root", ["note", "task", "learning_goal"])
async def test_delete_cascade_and_replay_delivers_only_tombstones_to_second_device(
    deletion_case, root
):
    case = deletion_case
    await add_reference(case, "evidence", active=False)
    await add_reference(case, "citation", active=False)
    op = case["operation"](root)
    result = await case["push"](op)
    assert result["status"] == "applied", result
    assert result["impact"] == {
        "deleted_learning_goal": int(root == "learning_goal"),
        "deleted_task": int(root != "note"),
        "deleted_note": int(root != "task"),
        "deleted_resource": int(root == "learning_goal"),
        "deleted_study_session": int(root != "note"),
        "detached_note": int(root == "task"),
        "detached_resource": int(root == "task"),
    }
    before_replay = await snapshot(case)
    assert (await case["push"](op))["status"] == "duplicate"
    assert await snapshot(case) == before_replay
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test", "X-Logion-Sync-Capabilities": "entity-deletion-v1"},
    ) as second:
        logged_in = await second.post(
            "/api/v1/auth/login",
            json={"email": case["email"], "password": case["password"], "device_name": "Delete B"},
        )
        assert logged_in.status_code == 200, logged_in.text
        device = next(
            item["id"]
            for item in (await second.get("/api/v1/auth/devices")).json()["devices"]
            if item["current"]
        )
        response = await second.post(
            f"/api/v1/workspaces/{case['workspace']}/sync/pull",
            json={
                **case["envelope"],
                "device_id": device,
                "message_type": "pull_request",
                "sync_epoch": case["epoch"],
                "cursor": 0,
                "limit": 100,
            },
        )
        assert response.status_code == 200, response.text
        changes = response.json()["changes"]
    tombstones = [change for change in changes if change["tombstone"]]
    expected = (
        {"note"}
        if root == "note"
        else {"task", "study_session"}
        if root == "task"
        else set(case["ids"])
    )
    assert {change["entity_type"] for change in tombstones} == expected
    assert all(
        change["payload"] == {} and change["deleted_at"] and change["server_version"] == 2
        for change in tombstones
    )
    async with session_factory() as db:
        note = await db.get(Note, case["ids"]["note"])
        session = await db.get(StudySession, case["ids"]["study_session"])
        if root == "task":
            assert note.deleted_at is None and note.task_id is None
            assert {change["entity_type"] for change in changes if not change["tombstone"]} == {
                "note",
                "resource",
            }
        if root != "note":
            assert session.status == "abandoned" and session.ended_at is not None


@pytest.mark.parametrize("root", ["note", "task", "learning_goal"])
async def test_update_after_deletion_is_manual_conflict_and_cannot_resurrect(deletion_case, root):
    case = deletion_case
    assert (await case["push"](case["operation"](root)))["status"] == "applied"
    update = case["operation"](
        root,
        operation_type="update",
        payload={"space_id": case["space"], "title": "offline update"},
    )
    result = await case["push"](update)
    assert result["status"] == "conflict", result
    conflict = result["conflict"]
    assert conflict["conflict_kind"] == "delete_update"
    assert conflict["remote_deleted_at"] and conflict["remote_payload"] == {}
    assert conflict["resolution_options"] == ["keep_remote", "dismiss"]
    resolution = case["operation"](root, base=2)
    resolution["conflict_resolution"] = {
        "conflict_id": conflict["conflict_id"],
        "resolution": "keep_remote",
        "expected_remote_version": 2,
    }
    assert (await case["push"](resolution))["status"] == "applied"


async def test_stale_delete_does_not_use_latest_version_from_dependency(deletion_case):
    case = deletion_case
    payload = {
        "space_id": case["space"],
        "task_id": str(case["ids"]["task"]),
        "title": "changed",
        "markdown_body": "changed",
    }
    first = case["operation"]("note", payload=payload, operation_type="update")
    assert (await case["push"](first))["server_version"] == 2
    assert (
        await case["push"](
            case["operation"]("note", payload=payload, operation_type="update", base=2)
        )
    )["server_version"] == 3
    stale = case["operation"]("note", dependencies=[first["operation_id"]])
    result = await case["push"](stale)
    assert result["status"] == "conflict" and result["conflict"]["conflict_kind"] == "delete_update"
    assert "remote_deleted_at" not in result["conflict"]


@pytest.mark.parametrize("root", ["note", "task", "learning_goal"])
async def test_stale_delete_uses_current_domain_payload_without_prior_sync_change(
    deletion_case, root
):
    case = deletion_case
    model = {"note": Note, "task": Task, "learning_goal": LearningGoal}[root]
    async with session_factory() as db:
        row = await db.get(model, case["ids"][root])
        row.version = 2
        row.title = "Online changed title"
        await db.commit()
    result = await case["push"](case["operation"](root))
    assert result["status"] == "conflict", result
    assert result["conflict"]["remote_payload"]["title"] == "Online changed title"
    assert result["conflict"]["conflict_kind"] == "delete_update"


async def test_soft_deleted_citation_does_not_block(deletion_case):
    case = deletion_case
    ref_id = await add_reference(case, "citation", active=False)
    async with session_factory() as db:
        row = await db.get(KnowledgeCitation, ref_id)
        row.deleted_at = datetime.now(UTC)
        row.status = "deleted"
        await db.commit()
    assert (await case["push"](case["operation"]("note")))["status"] == "applied"


@pytest.mark.parametrize("fail_at", [1, 2, 4])
async def test_cascade_failure_rolls_back_entities_ledger_and_audit(
    deletion_case, monkeypatch, fail_at
):
    case = deletion_case
    original = SyncPushService._append_derived
    calls = 0

    async def fail(self, *args, **kwargs):
        nonlocal calls
        result = await original(self, *args, **kwargs)
        calls += 1
        if calls == fail_at:
            raise SyncLedgerError("SYNC_CONTEXT_MISMATCH")
        return result

    monkeypatch.setattr(SyncPushService, "_append_derived", fail)
    before = await snapshot(case)
    result = await case["push"](case["operation"]("learning_goal"))
    assert result["status"] == "rejected"
    assert await snapshot(case) == before


async def test_deleted_note_has_no_historical_payload_in_pull_or_bootstrap(deletion_case):
    case = deletion_case
    payload = {
        "space_id": case["space"],
        "task_id": str(case["ids"]["task"]),
        "title": "secret history",
        "markdown_body": "secret history body",
    }
    assert (
        await case["push"](case["operation"]("note", payload=payload, operation_type="update"))
    )["status"] == "applied"
    assert (await case["push"](case["operation"]("note", base=2)))["status"] == "applied"
    response = await case["client"].post(
        f"/api/v1/workspaces/{case['workspace']}/sync/pull",
        json={
            **case["envelope"],
            "message_type": "pull_request",
            "sync_epoch": case["epoch"],
            "cursor": 0,
            "limit": 100,
        },
    )
    assert response.status_code == 200
    assert "secret history" not in response.text
    assert response.json()["changes"][0]["tombstone"] is True
    bootstrap = await case["client"].post(
        f"/api/v1/workspaces/{case['workspace']}/sync/bootstrap",
        json={
            **case["envelope"],
            "message_type": "bootstrap_request",
            "known_sync_epoch": None,
            "snapshot_id": None,
            "chunk_index": None,
        },
    )
    assert bootstrap.status_code == 200
    assert "secret history" not in bootstrap.text


@pytest.mark.parametrize("reference", ["evidence", "citation"])
async def test_concurrent_reference_finishes_before_delete_check(deletion_case, reference):
    case = deletion_case
    reference_id = await add_reference(case, reference, active=False)
    async with session_factory() as db:
        await db.scalar(select(Space.id).where(Space.id == UUID(case["space"])).with_for_update())
        row = await db.get(
            EvidenceItem if reference == "evidence" else KnowledgeCitation, reference_id
        )
        row.deleted_at = None
        if reference == "citation":
            row.status = "active"
            row.closed_by = row.closed_at = row.close_reason = None
        await db.flush()
        pending_delete = asyncio.create_task(case["push"](case["operation"]("note")))
        try:
            # Hold the same lock used by reference creation until its row is committed.
            await asyncio.sleep(0.1)
            assert not pending_delete.done()
            await db.commit()
            result = await asyncio.wait_for(pending_delete, timeout=5)
        finally:
            if not pending_delete.done():
                pending_delete.cancel()
    assert result["error_code"] == "SYNC_DELETE_BLOCKED_BY_REFERENCE"
    assert result["details"] == {
        "evidence_count": int(reference == "evidence"),
        "citation_count": int(reference == "citation"),
    }


async def test_yjs_update_after_delete_preserves_a_manual_conflict(deletion_case):
    case = deletion_case
    assert (await case["push"](case["operation"]("note")))["status"] == "applied"
    result = await case["push"](
        case["operation"](
            "note_document_update",
            entity_id=case["ids"]["note"],
            operation_type="update",
            payload={
                "space_id": case["space"],
                "yjs_generation": 1,
                "update_base64": base64.b64encode(state_from_markdown("offline text")).decode(),
            },
        )
    )
    assert result["status"] == "conflict", result
    assert result["conflict"]["conflict_kind"] == "delete_update"
    assert result["conflict"]["remote_deleted_at"]
    assert result["conflict"]["remote_payload"] == {}
    async with session_factory() as db:
        note = await db.get(Note, case["ids"]["note"])
        assert note.deleted_at is not None and note.markdown_body == "Retained secret body"


async def test_online_child_write_rejects_deleted_task(deletion_case):
    case = deletion_case
    assert (await case["push"](case["operation"]("task")))["status"] == "applied"
    response = await case["client"].post(
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/notes",
        headers={"X-CSRF-Token": case["client"].cookies["logion_csrf"]},
        json={
            "id": str(uuid4()),
            "task_id": str(case["ids"]["task"]),
            "title": "child",
            "markdown_body": "must not write",
        },
    )
    assert response.status_code == 404, response.text


@pytest.mark.parametrize("kind", ["note", "task", "learning_goal"])
async def test_deletion_releases_domain_quota(deletion_case, monkeypatch, kind):
    case = deletion_case
    settings = get_settings()
    monkeypatch.setattr(settings, "content_per_space_quota", 2)
    monkeypatch.setattr(settings, "task_per_goal_quota", 1)
    monkeypatch.setattr(settings, "goal_per_space_quota", 1)
    payload = {"id": str(uuid4()), "title": "Replacement"}
    if kind == "note":
        route = "notes"
        payload.update({"task_id": None, "markdown_body": "New content"})
    elif kind == "task":
        route = "tasks"
        payload.update({"goal_id": str(case["ids"]["learning_goal"])})
    else:
        route = "goals"
        payload = {
            "goal_id": str(uuid4()),
            "plan_id": str(uuid4()),
            "plan_version_id": str(uuid4()),
            "title": "Replacement",
            "desired_outcome": "Result",
            "weekly_minutes": 30,
            "phases": [
                {
                    "id": str(uuid4()),
                    "title": "Phase",
                    "position": 0,
                    "estimated_minutes": 30,
                    "acceptance_criteria": ["Proof"],
                }
            ],
        }
    path = f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/{route}"
    headers = {"X-CSRF-Token": case["client"].cookies["logion_csrf"]}
    full = await case["client"].post(path, headers=headers, json=payload)
    assert full.status_code == 409, full.text
    assert full.json()["code"] == "RESOURCE_QUOTA_EXCEEDED"
    assert (await case["push"](case["operation"](kind)))["status"] == "applied"
    available = await case["client"].post(path, headers=headers, json=payload)
    assert available.status_code == 201, available.text


@pytest.mark.parametrize(
    "scope", ["other_workspace", "other_private", "shared_viewer", "shared_editor"]
)
async def test_delete_authorization_and_preview_visibility(deletion_case, scope):
    case = deletion_case
    if scope != "shared_editor":
        await add_reference(case, "evidence")
        await add_reference(case, "citation")
    async with AsyncClient(
        transport=ASGITransport(
            app=app, client=(f"2001:db8::{uuid4().hex[:4]}:{uuid4().hex[:4]}", 54006)
        ),
        base_url="http://test",
        headers={"Origin": "http://test", "X-Logion-Sync-Capabilities": "entity-deletion-v1"},
    ) as other:
        email = f"deletion-other-{uuid4()}@example.com"
        registered = await other.post(
            "/api/v1/auth/register",
            json={"email": email, "password": case["password"], "device_name": "Other"},
        )
        assert registered.status_code == 201
        async with session_factory() as db:
            user = await db.scalar(select(User).where(User.email == email))
            if scope != "other_workspace":
                db.add(
                    WorkspaceMembership(
                        workspace_id=UUID(case["workspace"]),
                        user_id=user.id,
                        role="editor" if scope == "shared_editor" else "viewer",
                    )
                )
            if scope.startswith("shared"):
                space = await db.get(Space, UUID(case["space"]))
                space.visibility = "shared"
                space.owner_user_id = None
            await db.commit()
        device = next(
            row["id"]
            for row in (await other.get("/api/v1/auth/devices")).json()["devices"]
            if row["current"]
        )
        op = {**case["operation"]("note"), "device_id": device}
        preview = await other.get(
            f"/api/v1/workspaces/{case['workspace']}/sync/deletion-preview/note/{case['ids']['note']}"
        )
        result = await other.post(
            f"/api/v1/workspaces/{case['workspace']}/sync/push",
            headers={"X-CSRF-Token": other.cookies["logion_csrf"]},
            json={
                **case["envelope"],
                "device_id": device,
                "message_type": "push_request",
                "sync_epoch": case["epoch"],
                "operations": [op],
            },
        )
        if scope == "shared_editor":
            assert preview.status_code == 200, preview.text
            assert result.json()["results"][0]["status"] == "applied", result.text
        else:
            assert preview.status_code in (403, 404)
            assert "blockers" not in preview.text and "Private note" not in preview.text
            assert "evidence_count" not in result.text and "citation_count" not in result.text
            assert (
                result.status_code in (403, 404)
                or result.json()["results"][0]["error_code"] == "SYNC_OPERATION_FORBIDDEN"
            )
            async with session_factory() as db:
                assert (await db.get(Note, case["ids"]["note"])).deleted_at is None
