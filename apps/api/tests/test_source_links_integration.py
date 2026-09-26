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
from logion_api.memory.models import KnowledgeSourceLink
from logion_api.sync.models import SyncChange
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

EXCERPT = "A selected sentence from the note."
EXCERPT_SHA = hashlib.sha256(EXCERPT.encode("utf-8")).hexdigest()


@pytest_asyncio.fixture(loop_scope="session")
async def link_case():
    address = uuid4().hex
    original_overrides = dict(app.dependency_overrides)
    enabled = {"value": True}
    base_settings = get_settings()

    def settings():
        return base_settings.model_copy(update={"source_links_enabled": enabled["value"]})

    app.dependency_overrides[get_settings] = settings
    try:
        async with (
            AsyncClient(
                transport=ASGITransport(
                    app=app, client=(f"2001:db8::{address[:4]}:{address[4:8]}", 54110)
                ),
                base_url="http://test",
                headers={
                    "Origin": "http://test",
                    "X-Logion-Sync-Capabilities": "entity-deletion-v1",
                },
            ) as owner,
            AsyncClient(
                transport=ASGITransport(
                    app=app, client=(f"2001:db8::{address[8:12]}:{address[12:16]}", 54111)
                ),
                base_url="http://test",
                headers={
                    "Origin": "http://test",
                    "X-Logion-Sync-Capabilities": "entity-deletion-v1",
                },
            ) as viewer,
        ):
            registrations = []
            for client, label in ((owner, "owner"), (viewer, "viewer")):
                registered = await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"source-link-{label}-{uuid4()}@example.com",
                        "password": f"source-link-{uuid4()}",
                        "device_name": f"Source link {label}",
                    },
                )
                assert registered.status_code == 201, registered.text
                registrations.append(registered.json())
            workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            private_space = (await owner.get(f"/api/v1/workspaces/{workspace}/spaces")).json()[
                "spaces"
            ][0]["id"]
            shared = await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
                json={"name": "Shared sources", "visibility": "shared"},
            )
            assert shared.status_code == 201, shared.text
            async with session_factory() as db:
                db.add(
                    WorkspaceMembership(
                        workspace_id=UUID(workspace),
                        user_id=UUID(registrations[1]["user"]["id"]),
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

            def envelope(role):
                return {
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": devices[role],
                }

            async def bootstrap(client, role):
                response = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                    json={
                        **envelope(role),
                        "message_type": "bootstrap_request",
                        "known_sync_epoch": None,
                        "snapshot_id": None,
                        "chunk_index": None,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()

            epoch = (await bootstrap(owner, "owner"))["sync_epoch"]

            def operation(entity_type, entity_id, payload, *, kind="create", base=0, deps=()):
                return {
                    **envelope("owner"),
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

            async def push(*ops):
                response = await owner.post(
                    f"/api/v1/workspaces/{workspace}/sync/push",
                    headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
                    json={
                        **envelope("owner"),
                        "message_type": "push_request",
                        "sync_epoch": epoch,
                        "operations": list(ops),
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()["results"]

            async def pull(client, role):
                response = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/pull",
                    json={
                        **envelope(role),
                        "message_type": "pull_request",
                        "sync_epoch": epoch,
                        "cursor": 0,
                        "limit": 500,
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()["changes"]

            async def seed(space):
                note_id, topic_id = uuid4(), uuid4()
                note_op = operation(
                    "note",
                    note_id,
                    {
                        "space_id": space,
                        "task_id": None,
                        "title": "Source note",
                        "markdown_body": f"Intro. {EXCERPT} Outro.",
                    },
                )
                topic_op = operation(
                    "topic",
                    topic_id,
                    {"space_id": space, "title": "Derived topic", "description": EXCERPT},
                )
                results = await push(note_op, topic_op)
                assert [item["status"] for item in results] == ["applied", "applied"]
                return note_id, topic_id, note_op, topic_op

            def link_op(space, note_id, target_id, deps, **overrides):
                payload = {
                    "space_id": space,
                    "source_kind": "note",
                    "source_id": str(note_id),
                    "target_kind": "topic",
                    "target_id": str(target_id),
                    "excerpt_sha256": EXCERPT_SHA,
                    "excerpt_start": 7,
                    "excerpt_end": 7 + len(EXCERPT),
                    "source_version": 1,
                    **overrides,
                }
                return operation(
                    "source_link", uuid4(), payload, deps=[op["operation_id"] for op in deps]
                )

            yield {
                "owner": owner,
                "viewer": viewer,
                "workspace": workspace,
                "private_space": private_space,
                "shared_space": shared.json()["id"],
                "enabled": enabled,
                "operation": operation,
                "push": push,
                "pull": pull,
                "bootstrap": bootstrap,
                "seed": seed,
                "link_op": link_op,
            }
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def test_capability_and_flag_off_rejection(link_case):
    case = link_case
    url = (
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['shared_space']}"
        "/source-links/capabilities"
    )
    assert (await case["owner"].get(url)).json() == {"source_links_enabled": True}
    note_id, topic_id, note_op, topic_op = await case["seed"](case["shared_space"])
    case["enabled"]["value"] = False
    assert (await case["owner"].get(url)).json() == {"source_links_enabled": False}
    [result] = await case["push"](
        case["link_op"](case["shared_space"], note_id, topic_id, [note_op, topic_op])
    )
    assert result["status"] == "rejected"
    assert result["error_code"] == "SYNC_OPERATION_FORBIDDEN"
    async with session_factory() as db:
        assert (
            await db.scalar(
                select(KnowledgeSourceLink).where(KnowledgeSourceLink.source_id == note_id)
            )
        ) is None


async def test_link_created_in_batch_replays_and_syncs_without_text(link_case):
    case = link_case
    space = case["shared_space"]
    note_id, topic_id = uuid4(), uuid4()
    note_op = case["operation"](
        "note",
        note_id,
        {
            "space_id": space,
            "task_id": None,
            "title": "Batch note",
            "markdown_body": f"Intro. {EXCERPT}",
        },
    )
    topic_op = case["operation"](
        "topic", topic_id, {"space_id": space, "title": "Batch topic", "description": EXCERPT}
    )
    link = case["link_op"](space, note_id, topic_id, [note_op, topic_op])
    results = await case["push"](note_op, topic_op, link)
    assert [item["status"] for item in results] == ["applied", "applied", "applied"], results
    assert (await case["push"](link))[0]["status"] == "duplicate"

    owner_changes = [
        item
        for item in await case["pull"](case["owner"], "owner")
        if item["entity_type"] == "source_link"
    ]
    assert [item["entity_id"] for item in owner_changes] == [link["entity_id"]]
    payload = owner_changes[0]["payload"]
    assert payload["excerpt_sha256"] == EXCERPT_SHA
    assert EXCERPT not in str(payload)
    viewer_ids = {
        item["entity_id"]
        for item in await case["pull"](case["viewer"], "viewer")
        if item["entity_type"] == "source_link"
    }
    assert link["entity_id"] in viewer_ids
    snapshot = await case["bootstrap"](case["owner"], "owner")
    assert ("source_link", link["entity_id"]) in {
        (item["entity_type"], item["entity_id"]) for item in snapshot["records"]
    }
    async with session_factory() as db:
        audit = await db.scalar(
            select(AuditEvent).where(
                AuditEvent.event_type == "memory.source_link_created",
                AuditEvent.target_id == UUID(link["entity_id"]),
            )
        )
        assert audit.event_metadata == {"space_id": space, "target_kind": "topic"}


async def test_private_space_links_stay_invisible_to_other_members(link_case):
    case = link_case
    space = case["private_space"]
    note_id, topic_id, note_op, topic_op = await case["seed"](space)
    link = case["link_op"](space, note_id, topic_id, [note_op, topic_op])
    assert (await case["push"](link))[0]["status"] == "applied"
    assert link["entity_id"] not in {
        item["entity_id"] for item in await case["pull"](case["viewer"], "viewer")
    }
    snapshot = await case["bootstrap"](case["viewer"], "viewer")
    assert link["entity_id"] not in {item["entity_id"] for item in snapshot["records"]}


async def test_invalid_links_are_rejected(link_case):
    case = link_case
    note_id, topic_id, note_op, topic_op = await case["seed"](case["shared_space"])
    _, private_topic, _, private_op = await case["seed"](case["private_space"])
    invalid = [
        case["link_op"](case["shared_space"], note_id, topic_id, [], excerpt_sha256="XYZ"),
        case["link_op"](case["shared_space"], note_id, topic_id, [], excerpt_end=None),
        case["link_op"](case["shared_space"], note_id, topic_id, [], excerpt_end=7),
        case["link_op"](case["shared_space"], note_id, private_topic, [private_op]),
        case["link_op"](case["shared_space"], note_id, uuid4(), [], target_kind="quiz_item"),
    ]
    for op in invalid:
        [result] = await case["push"](op)
        assert result["status"] == "rejected", (op["payload"], result)
        assert result["error_code"] == "SYNC_OPERATION_INVALID", (op["payload"], result)


async def test_note_deletion_keeps_links_and_topic_deletion_removes_them(link_case):
    case = link_case
    space = case["shared_space"]
    note_id, topic_id, note_op, topic_op = await case["seed"](space)
    link = case["link_op"](space, note_id, topic_id, [note_op, topic_op])
    assert (await case["push"](link))[0]["status"] == "applied"
    link_id = UUID(link["entity_id"])

    [note_deleted] = await case["push"](
        case["operation"]("note", note_id, {}, kind="delete", base=1, deps=[])
    )
    assert note_deleted["status"] == "applied", note_deleted
    async with session_factory() as db:
        assert (await db.get(KnowledgeSourceLink, link_id)).deleted_at is None

    [topic_deleted] = await case["push"](
        case["operation"]("topic", topic_id, {}, kind="delete", base=1, deps=[])
    )
    assert topic_deleted["status"] == "applied", topic_deleted
    async with session_factory() as db:
        stored = await db.get(KnowledgeSourceLink, link_id)
        assert stored.deleted_at is not None
        assert stored.version == 2
        tombstone = await db.scalar(
            select(SyncChange).where(
                SyncChange.entity_type == "source_link",
                SyncChange.entity_id == link_id,
                SyncChange.tombstone.is_(True),
            )
        )
        assert tombstone is not None
    assert (link["entity_id"], True) in {
        (item["entity_id"], item["tombstone"])
        for item in await case["pull"](case["viewer"], "viewer")
    }
