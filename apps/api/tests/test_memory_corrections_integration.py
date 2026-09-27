"""ADR-0036: correcting topics, prerequisites and recall items through sync-v1."""

import hashlib
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.memory.models import (
    KnowledgeSourceLink,
    QuizAttempt,
    QuizItem,
    Topic,
    TopicDependency,
)
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import func, select

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture(loop_scope="session")
async def memory_case():
    address = uuid4().hex
    original_overrides = dict(app.dependency_overrides)
    base_settings = get_settings()
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={"source_links_enabled": True}
    )
    headers = {"Origin": "http://test", "X-Logion-Sync-Capabilities": "entity-deletion-v1"}
    try:
        async with (
            AsyncClient(
                transport=ASGITransport(
                    app=app, client=(f"2001:db8::{address[:4]}:{address[4:8]}", 54210)
                ),
                base_url="http://test",
                headers=headers,
            ) as owner,
            AsyncClient(
                transport=ASGITransport(
                    app=app, client=(f"2001:db8::{address[8:12]}:{address[12:16]}", 54211)
                ),
                base_url="http://test",
                headers=headers,
            ) as viewer,
        ):
            users = []
            for client, label in ((owner, "owner"), (viewer, "viewer")):
                registered = await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"memory-edit-{label}-{uuid4()}@example.com",
                        "password": f"memory-edit-{uuid4()}",
                        "device_name": f"Memory edit {label}",
                    },
                )
                assert registered.status_code == 201, registered.text
                users.append(registered.json()["user"]["id"])
            workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            shared = await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
                json={"name": "Shared memory corrections", "visibility": "shared"},
            )
            assert shared.status_code == 201, shared.text
            space = shared.json()["id"]
            async with session_factory() as db:
                db.add(
                    WorkspaceMembership(
                        workspace_id=UUID(workspace),
                        user_id=UUID(users[1]),
                        role="viewer",
                        status="active",
                        joined_at=datetime.now(UTC),
                    )
                )
                await db.commit()

            async def device_of(client):
                devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
                return next(item["id"] for item in devices if item["current"])

            devices = {"owner": await device_of(owner), "viewer": await device_of(viewer)}
            clients = {"owner": owner, "viewer": viewer}

            def envelope(role):
                return {
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": devices[role],
                }

            epochs = {}
            for role, client in clients.items():
                boot = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                    json={
                        **envelope(role),
                        "message_type": "bootstrap_request",
                        "known_sync_epoch": None,
                        "snapshot_id": None,
                        "chunk_index": None,
                    },
                )
                assert boot.status_code == 200, boot.text
                epochs[role] = boot.json()["sync_epoch"]

            def operation(
                entity_type,
                entity_id,
                payload,
                *,
                kind="create",
                base=0,
                deps=(),
                role="owner",
            ):
                return {
                    **envelope(role),
                    "operation_id": str(uuid4()),
                    "entity_type": entity_type,
                    "entity_id": str(entity_id),
                    "operation_type": kind,
                    "base_version": base,
                    "client_occurred_at": datetime.now(UTC).isoformat(),
                    "payload": payload,
                    "payload_hash": canonical_hash(payload),
                    "dependencies": [str(item) for item in deps],
                }

            async def push(*ops, role="owner"):
                client = clients[role]
                response = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/push",
                    headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
                    json={
                        **envelope(role),
                        "message_type": "push_request",
                        "sync_epoch": epochs[role],
                        "operations": list(ops),
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()["results"]

            async def pull(role="viewer"):
                client = clients[role]
                response = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/pull",
                    json={
                        **envelope(role),
                        "message_type": "pull_request",
                        "sync_epoch": epochs[role],
                        "cursor": 0,
                        "limit": 500,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()["changes"]

            async def seed_topic(title="Consensus"):
                topic_id = uuid4()
                payload = {"space_id": space, "title": title, "description": "first"}
                [result] = await push(operation("topic", topic_id, payload))
                assert result["status"] == "applied", result
                return topic_id, payload

            async def seed_quiz(topic_id, mode="exact_match"):
                quiz_id = uuid4()
                payload = {
                    "space_id": space,
                    "topic_id": str(topic_id),
                    "prompt": "When is an entry committed?",
                    "answer_key": "After a majority acknowledges it",
                    "explanation": "",
                    "evaluation_mode": mode,
                }
                [result] = await push(operation("quiz_item", quiz_id, payload))
                assert result["status"] == "applied", result
                return quiz_id, payload

            yield {
                "owner": owner,
                "workspace": workspace,
                "space": space,
                "operation": operation,
                "push": push,
                "pull": pull,
                "seed_topic": seed_topic,
                "seed_quiz": seed_quiz,
            }
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def test_topic_update_applies_replays_and_audits_field_names(memory_case):
    case = memory_case
    topic_id, payload = await case["seed_topic"]()
    edit = case["operation"](
        "topic", topic_id, {**payload, "title": "Consensus (Raft)"}, kind="update", base=1
    )
    [result] = await case["push"](edit)
    assert result["status"] == "applied", result
    assert result["server_version"] == 2
    assert (await case["push"](edit))[0]["status"] == "duplicate"
    async with session_factory() as db:
        topic = await db.get(Topic, topic_id)
        assert (topic.title, topic.description, topic.version) == ("Consensus (Raft)", "first", 2)
        audit = await db.scalar(
            select(AuditEvent).where(
                AuditEvent.event_type == "memory.topic_updated",
                AuditEvent.target_id == topic_id,
            )
        )
        assert audit.event_metadata == {"fields": ["title"]}
    changes = [c for c in await case["pull"]() if c["entity_id"] == str(topic_id)]
    assert changes[-1]["payload"]["title"] == "Consensus (Raft)"


async def test_stale_topic_update_conflicts_and_keep_local_wins(memory_case):
    case = memory_case
    topic_id, payload = await case["seed_topic"]()
    first = case["operation"](
        "topic", topic_id, {**payload, "title": "Remote"}, kind="update", base=1
    )
    assert (await case["push"](first))[0]["status"] == "applied"
    local_payload = {**payload, "title": "Local"}
    stale = case["operation"]("topic", topic_id, local_payload, kind="update", base=1)
    [conflict] = await case["push"](stale)
    assert conflict["status"] == "conflict", conflict
    record = conflict["conflict"]
    assert record["resolution_options"] == ["keep_local", "keep_remote", "dismiss"]
    resolve = case["operation"]("topic", topic_id, local_payload, kind="update", base=2)
    resolve["conflict_resolution"] = {
        "conflict_id": record["conflict_id"],
        "resolution": "keep_local",
        "expected_remote_version": 2,
    }
    [resolved] = await case["push"](resolve)
    assert resolved["status"] == "applied", resolved
    async with session_factory() as db:
        assert (await db.get(Topic, topic_id)).title == "Local"


async def test_quiz_item_update_keeps_hidden_answer_and_locks_topic_and_mode(memory_case):
    case = memory_case
    topic_id, _ = await case["seed_topic"]()
    other_topic, _ = await case["seed_topic"]("Other")
    quiz_id, payload = await case["seed_quiz"](topic_id)
    # A device that pulled the item never saw its answer or explanation.
    pulled_shape = {
        key: value for key, value in payload.items() if key not in ("answer_key", "explanation")
    }
    edit = case["operation"](
        "quiz_item",
        quiz_id,
        {**pulled_shape, "prompt": "When does Raft commit?"},
        kind="update",
        base=1,
    )
    assert (await case["push"](edit))[0]["status"] == "applied"
    async with session_factory() as db:
        item = await db.get(QuizItem, quiz_id)
        assert item.prompt == "When does Raft commit?"
        assert item.answer_key == "After a majority acknowledges it"
    moved = case["operation"](
        "quiz_item", quiz_id, {**payload, "topic_id": str(other_topic)}, kind="update", base=2
    )
    assert (await case["push"](moved))[0]["error_code"] == "SYNC_OPERATION_INVALID"
    # No attempt yet: the judging mode may still change.
    relaxed = case["operation"](
        "quiz_item", quiz_id, {**payload, "evaluation_mode": "self_assessed"}, kind="update", base=2
    )
    assert (await case["push"](relaxed))[0]["status"] == "applied"
    response = await case["owner"].post(
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/quiz-items/{quiz_id}/attempts",
        headers={"X-CSRF-Token": case["owner"].cookies["logion_csrf"]},
        json={
            "id": str(uuid4()),
            "error_pattern_id": str(uuid4()),
            "schedule_id": str(uuid4()),
            "response_text": "after a quorum",
            "confidence": 4,
            "duration_seconds": 20,
            "self_assessed_correct": True,
            "error_cause": None,
        },
    )
    assert response.status_code == 201, response.text
    locked = case["operation"](
        "quiz_item", quiz_id, {**payload, "evaluation_mode": "exact_match"}, kind="update", base=3
    )
    assert (await case["push"](locked))[0]["error_code"] == "SYNC_OPERATION_INVALID"
    async with session_factory() as db:
        assert (await db.get(QuizItem, quiz_id)).evaluation_mode == "self_assessed"


async def test_retiring_a_recall_item_keeps_history_and_unblocks_topic_deletion(memory_case):
    case = memory_case
    topic_id, _ = await case["seed_topic"]()
    quiz_id, _ = await case["seed_quiz"](topic_id)
    note_id = uuid4()
    note = case["operation"](
        "note",
        note_id,
        {"space_id": case["space"], "task_id": None, "title": "Source", "markdown_body": "text"},
    )
    link_id = uuid4()
    link = case["operation"](
        "source_link",
        link_id,
        {
            "space_id": case["space"],
            "source_kind": "note",
            "source_id": str(note_id),
            "target_kind": "quiz_item",
            "target_id": str(quiz_id),
            "excerpt_sha256": hashlib.sha256(b"text").hexdigest(),
            "excerpt_start": None,
            "excerpt_end": None,
            "source_version": 1,
        },
        deps=[note["operation_id"]],
    )
    assert [r["status"] for r in await case["push"](note, link)] == ["applied", "applied"]
    blocked = await case["push"](case["operation"]("topic", topic_id, {}, kind="delete", base=1))
    assert blocked[0]["error_code"] == "SYNC_DELETE_BLOCKED_BY_REFERENCE"
    [retired] = await case["push"](
        case["operation"]("quiz_item", quiz_id, {}, kind="delete", base=1)
    )
    assert retired["status"] == "applied", retired
    async with session_factory() as db:
        assert (await db.get(QuizItem, quiz_id)).deleted_at is not None
        assert (await db.get(KnowledgeSourceLink, link_id)).deleted_at is not None
    tombstones = {
        (c["entity_type"], c["entity_id"]) for c in await case["pull"]() if c["tombstone"]
    }
    assert {("quiz_item", str(quiz_id)), ("source_link", str(link_id))} <= tombstones
    edit_after = case["operation"](
        "quiz_item",
        quiz_id,
        {
            "space_id": case["space"],
            "topic_id": str(topic_id),
            "prompt": "x",
            "evaluation_mode": "exact_match",
        },
        kind="update",
        base=2,
    )
    assert (await case["push"](edit_after))[0]["status"] == "conflict"
    [deleted] = await case["push"](case["operation"]("topic", topic_id, {}, kind="delete", base=1))
    assert deleted["status"] == "applied", deleted


async def test_attempt_history_survives_retirement(memory_case):
    case = memory_case
    topic_id, _ = await case["seed_topic"]()
    quiz_id, _ = await case["seed_quiz"](topic_id)
    response = await case["owner"].post(
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/quiz-items/{quiz_id}/attempts",
        headers={"X-CSRF-Token": case["owner"].cookies["logion_csrf"]},
        json={
            "id": str(uuid4()),
            "error_pattern_id": str(uuid4()),
            "schedule_id": str(uuid4()),
            "response_text": "wrong",
            "confidence": 2,
            "duration_seconds": 10,
            "self_assessed_correct": None,
            "error_cause": "recall_gap",
        },
    )
    assert response.status_code == 201, response.text
    [retired] = await case["push"](
        case["operation"]("quiz_item", quiz_id, {}, kind="delete", base=1)
    )
    assert retired["status"] == "applied", retired
    async with session_factory() as db:
        attempts = await db.scalar(
            select(func.count(QuizAttempt.id)).where(QuizAttempt.quiz_item_id == quiz_id)
        )
        assert attempts == 1
    # Attempts still protect the topic's learning history (ADR-0031).
    blocked = await case["push"](case["operation"]("topic", topic_id, {}, kind="delete", base=1))
    assert blocked[0]["error_code"] == "SYNC_DELETE_BLOCKED_BY_REFERENCE"


async def test_prerequisite_can_be_deleted(memory_case):
    case = memory_case
    first, _ = await case["seed_topic"]("First")
    second, _ = await case["seed_topic"]("Second")
    dependency_id = uuid4()
    [created] = await case["push"](
        case["operation"](
            "topic_dependency",
            dependency_id,
            {
                "space_id": case["space"],
                "prerequisite_topic_id": str(first),
                "dependent_topic_id": str(second),
            },
        )
    )
    assert created["status"] == "applied", created
    [deleted] = await case["push"](
        case["operation"]("topic_dependency", dependency_id, {}, kind="delete", base=1)
    )
    assert deleted["status"] == "applied", deleted
    async with session_factory() as db:
        assert (await db.get(TopicDependency, dependency_id)).deleted_at is not None
    assert ("topic_dependency", str(dependency_id), True) in {
        (c["entity_type"], c["entity_id"], c["tombstone"]) for c in await case["pull"]()
    }


async def test_viewer_cannot_correct_shared_memory(memory_case):
    case = memory_case
    topic_id, payload = await case["seed_topic"]()
    [result] = await case["push"](
        case["operation"](
            "topic", topic_id, {**payload, "title": "Viewer"}, kind="update", base=1, role="viewer"
        ),
        role="viewer",
    )
    assert result["status"] == "rejected"
    assert result["error_code"] == "SYNC_OPERATION_FORBIDDEN"
    async with session_factory() as db:
        assert (await db.get(Topic, topic_id)).title == "Consensus"
