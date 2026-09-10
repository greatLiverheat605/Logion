import json
import os
from uuid import UUID, uuid4

import pytest
from anyio import Path
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import User
from logion_api.main import app
from logion_api.sync.models import ProcessedSyncOperation
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import Space, WorkspaceMembership
from sqlalchemy import select
from test_sync_delete import deletion_case as deletion_case
from test_sync_delete import snapshot

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def legacy_sync(case, route, body, capabilities=None):
    request = case["client"].build_request(
        "POST",
        f"/api/v1/workspaces/{case['workspace']}/sync/{route}",
        headers={"X-CSRF-Token": case["client"].cookies["logion_csrf"]},
        json={**case["envelope"], **body},
    )
    request.headers.pop("X-Logion-Sync-Capabilities", None)
    if capabilities is not None:
        request.headers["X-Logion-Sync-Capabilities"] = capabilities
    response = await case["client"].send(request)
    if (
        (destination := os.environ.get("LOGION_SYNC_COMPAT_RESPONSES"))
        and response.status_code == 200
        and "entity-deletion-v1" not in [part.strip() for part in (capabilities or "").split(",")]
    ):
        output = Path(destination)
        await output.mkdir(parents=True, exist_ok=True)
        await (output / f"{uuid4()}.json").write_text(json.dumps(response.json()), encoding="utf-8")
    return response


def assert_upgrade(response, case):
    assert response.status_code == 200, response.text
    assert response.json() == {
        "message_type": "sync_control",
        "protocol_version": "sync-v1",
        "min_supported_version": "sync-v1",
        "action": "upgrade_required",
        "reason_code": "PROTOCOL_UNSUPPORTED",
        "server_sync_epoch": case["epoch"],
    }


@pytest.mark.parametrize("capabilities", [None, "", "future-v1", "entity-deletion-v10"])
async def test_legacy_delete_is_not_acknowledged_or_written(deletion_case, capabilities):
    case = deletion_case
    before = await snapshot(case)
    op = case["operation"]("note")
    response = await legacy_sync(
        case,
        "push",
        {
            "message_type": "push_request",
            "sync_epoch": case["epoch"],
            "operations": [op],
        },
        capabilities,
    )
    assert_upgrade(response, case)
    assert await snapshot(case) == before
    assert (await case["push"](op))["status"] == "applied"
    assert (await case["push"](op))["status"] == "duplicate"


async def test_legacy_mixed_batch_rolls_back_before_returning_upgrade(deletion_case):
    case = deletion_case
    assert (await case["push"](case["operation"]("note")))["status"] == "applied"
    before = await snapshot(case)
    space_id = uuid4()
    first = case["operation"](
        "space",
        entity_id=space_id,
        base=0,
        payload={"name": "Unacknowledged space", "visibility": "private"},
        operation_type="create",
    )
    second = case["operation"]("note", payload={"title": "Unsent"}, operation_type="update")
    response = await legacy_sync(
        case,
        "push",
        {
            "message_type": "push_request",
            "sync_epoch": case["epoch"],
            "operations": [first, second],
        },
    )
    assert_upgrade(response, case)
    assert await snapshot(case) == before
    async with session_factory() as db:
        assert await db.get(Space, space_id) is None
        assert await db.get(ProcessedSyncOperation, UUID(first["operation_id"])) is None
    retried = await legacy_sync(
        case,
        "push",
        {
            "message_type": "push_request",
            "sync_epoch": case["epoch"],
            "operations": [first, second],
        },
        "future-v1, entity-deletion-v1",
    )
    assert [item["status"] for item in retried.json()["results"]] == ["applied", "conflict"]
    assert retried.json()["results"][1]["conflict"]["remote_deleted_at"] is not None


async def test_legacy_pull_keeps_cursor_and_bootstrap_cannot_bypass_upgrade(deletion_case):
    case = deletion_case
    assert (await case["push"](case["operation"]("note")))["status"] == "applied"
    pull = {"message_type": "pull_request", "sync_epoch": case["epoch"], "cursor": 0, "limit": 100}
    assert_upgrade(await legacy_sync(case, "pull", pull), case)
    assert_upgrade(
        await legacy_sync(
            case,
            "bootstrap",
            {
                "message_type": "bootstrap_request",
                "known_sync_epoch": case["epoch"],
                "snapshot_id": None,
                "chunk_index": None,
            },
        ),
        case,
    )
    resumed = await legacy_sync(case, "pull", pull, "entity-deletion-v1")
    assert resumed.status_code == 200
    assert resumed.json()["from_cursor"] == 0
    assert any(change["tombstone"] for change in resumed.json()["changes"])
    initial = await legacy_sync(
        case,
        "bootstrap",
        {
            "message_type": "bootstrap_request",
            "known_sync_epoch": None,
            "snapshot_id": None,
            "chunk_index": None,
        },
    )
    assert initial.json()["message_type"] == "bootstrap_response"


async def test_legacy_ordinary_push_pull_replay_and_conflict_keep_old_wire(deletion_case):
    case = deletion_case
    op = case["operation"](
        "note",
        payload={
            "space_id": case["space"],
            "task_id": str(case["ids"]["task"]),
            "title": "Ordinary edit",
            "markdown_body": "Ordinary body",
        },
        operation_type="update",
    )
    body = {"message_type": "push_request", "sync_epoch": case["epoch"], "operations": [op]}
    applied = (await legacy_sync(case, "push", body)).json()["results"][0]
    duplicate = (await legacy_sync(case, "push", body)).json()["results"][0]
    assert applied["status"] == "applied" and duplicate["status"] == "duplicate"
    assert "impact" not in applied and "impact" not in duplicate
    op["operation_id"] = str(uuid4())
    conflict = (await legacy_sync(case, "push", body)).json()["results"][0]["conflict"]
    assert conflict["conflict_kind"] == "content"
    assert "remote_deleted_at" not in conflict
    op["operation_id"] = str(uuid4())
    op["payload_hash"] = canonical_hash({"wrong": "hash"})
    rejected = (await legacy_sync(case, "push", body)).json()["results"][0]
    assert rejected["status"] == "rejected" and "details" not in rejected
    pulled = await legacy_sync(
        case,
        "pull",
        {
            "message_type": "pull_request",
            "sync_epoch": case["epoch"],
            "cursor": 0,
            "limit": 100,
        },
    )
    assert pulled.json()["message_type"] == "pull_response"
    assert not any(change["tombstone"] for change in pulled.json()["changes"])


async def test_capability_header_is_bounded_and_allowed_by_cors(deletion_case):
    case = deletion_case
    before = await snapshot(case)
    response = await legacy_sync(
        case,
        "push",
        {
            "message_type": "push_request",
            "sync_epoch": case["epoch"],
            "operations": [case["operation"]("note")],
        },
        "x" * 257,
    )
    assert response.status_code == 422
    assert await snapshot(case) == before
    preflight = await case["client"].options(
        f"/api/v1/workspaces/{case['workspace']}/sync/push",
        headers={
            "Origin": "http://test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "X-Logion-Sync-Capabilities,X-CSRF-Token",
        },
    )
    assert preflight.status_code == 200
    assert "x-logion-sync-capabilities" in preflight.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize("context", ["workspace_id", "device_id", "sync_epoch"])
async def test_upgrade_does_not_bypass_sync_context(deletion_case, context):
    case = deletion_case
    before = await snapshot(case)
    response = await legacy_sync(
        case,
        "push",
        {
            "message_type": "push_request",
            "sync_epoch": case["epoch"],
            "operations": [case["operation"]("note")],
            context: str(uuid4()),
        },
    )
    if context == "sync_epoch":
        assert response.json()["action"] == "rebootstrap_required"
    else:
        assert response.status_code == 403
    assert await snapshot(case) == before


async def test_private_tombstone_does_not_force_other_legacy_member_to_upgrade(deletion_case):
    case = deletion_case
    assert (await case["push"](case["operation"]("note")))["status"] == "applied"
    async with AsyncClient(
        transport=ASGITransport(
            app=app, client=(f"2001:db8::{uuid4().hex[:4]}:{uuid4().hex[:4]}", 54007)
        ),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        email = f"legacy-member-{uuid4()}@example.com"
        response = await other.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": case["password"],
                "device_name": "Legacy member",
            },
        )
        assert response.status_code == 201
        async with session_factory() as db:
            user = await db.scalar(select(User).where(User.email == email))
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(case["workspace"]), user_id=user.id, role="viewer"
                )
            )
            await db.commit()
        device = next(
            row["id"]
            for row in (await other.get("/api/v1/auth/devices")).json()["devices"]
            if row["current"]
        )
        response = await other.post(
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
        assert response.status_code == 200
        assert response.json()["message_type"] == "pull_response"
        assert response.json()["changes"] == []
        assert str(case["ids"]["note"]) not in response.text


async def test_initial_legacy_multichunk_bootstrap_continues(deletion_case):
    case = deletion_case
    async with session_factory() as db:
        actor = case["common"]["created_by"]
        db.add_all(
            [
                Space(
                    id=uuid4(),
                    workspace_id=UUID(case["workspace"]),
                    name=f"Initial {index}",
                    visibility="private",
                    owner_user_id=actor,
                    created_by=actor,
                    updated_by=actor,
                )
                for index in range(101)
            ]
        )
        await db.commit()
    body = {
        "message_type": "bootstrap_request",
        "known_sync_epoch": None,
        "snapshot_id": None,
        "chunk_index": None,
    }
    first = (await legacy_sync(case, "bootstrap", body)).json()
    assert first["chunk_count"] >= 2
    for index in range(1, first["chunk_count"]):
        response = await legacy_sync(
            case,
            "bootstrap",
            {
                **body,
                "known_sync_epoch": first["sync_epoch"],
                "snapshot_id": first["snapshot_id"],
                "chunk_index": index,
            },
        )
        assert response.json()["message_type"] == "bootstrap_response"
        assert response.json()["chunk_index"] == index
        assert response.json()["snapshot_checksum"] == first["snapshot_checksum"]
