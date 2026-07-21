from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.sync.models import ProcessedSyncOperation, SyncChange, WorkspaceSyncState
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import Space
from sqlalchemy import func, select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_sync_push_applies_replays_and_partially_rejects_in_order() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.50", 45000)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        registered = await client.post(
            "/api/v1/auth/register",
            json={
                "email": f"sync-push-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Sync device",
            },
        )
        assert registered.status_code == 201, registered.text
        csrf = client.cookies["logion_csrf"]
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device_id = UUID(next(device["id"] for device in devices if device["current"]))

        async with session_factory() as db:
            state = WorkspaceSyncState(workspace_id=workspace_id)
            db.add(state)
            await db.commit()
            sync_epoch = state.sync_epoch

        entity_id = uuid4()
        operation_id = uuid4()
        payload = {"name": "Offline research", "visibility": "private"}
        operation = {
            "operation_id": str(operation_id),
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(device_id),
            "entity_type": "space",
            "entity_id": str(entity_id),
            "operation_type": "create",
            "base_version": 0,
            "client_occurred_at": datetime.now(UTC).isoformat(),
            "payload": payload,
            "payload_hash": canonical_hash(payload),
            "dependencies": [],
        }
        unsupported_id = uuid4()
        unsupported = {
            **operation,
            "operation_id": str(unsupported_id),
            "entity_type": "note",
            "entity_id": str(uuid4()),
        }
        dependent = {
            **operation,
            "operation_id": str(uuid4()),
            "entity_id": str(uuid4()),
            "dependencies": [str(unsupported_id)],
        }
        envelope = {
            "message_type": "push_request",
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(device_id),
            "sync_epoch": str(sync_epoch),
            "operations": [operation, unsupported, dependent],
        }
        response = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf},
            json=envelope,
        )
        assert response.status_code == 200, response.text
        results = response.json()["results"]
        assert [result["status"] for result in results] == [
            "applied",
            "rejected",
            "blocked_dependency",
        ]

        replay = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf},
            json={**envelope, "operations": [operation]},
        )
        assert replay.status_code == 200, replay.text
        assert replay.json()["results"][0]["status"] == "duplicate"

        pull = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull",
            json={
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "sync_epoch": str(sync_epoch),
                "cursor": 0,
                "limit": 1,
            },
        )
        assert pull.status_code == 200, pull.text
        assert pull.json()["next_cursor"] == 1
        assert pull.json()["changes"][0]["entity_id"] == str(entity_id)

        first_chunk = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json={
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            },
        )
        assert first_chunk.status_code == 200, first_chunk.text
        snapshot = first_chunk.json()
        assert snapshot["cursor"] == 1
        assert snapshot["chunk_count"] == 1
        assert str(entity_id) in {record["entity_id"] for record in snapshot["records"]}

        resumed_chunk = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json={
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "known_sync_epoch": str(sync_epoch),
                "snapshot_id": snapshot["snapshot_id"],
                "chunk_index": 0,
            },
        )
        assert resumed_chunk.status_code == 200
        assert resumed_chunk.json()["snapshot_checksum"] == snapshot["snapshot_checksum"]

        wrong_epoch = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf},
            json={**envelope, "sync_epoch": str(uuid4()), "operations": [operation]},
        )
        assert wrong_epoch.status_code == 200
        assert wrong_epoch.json()["action"] == "rebootstrap_required"

    async with session_factory() as db:
        assert await db.get(Space, entity_id) is not None
        count = await db.scalar(select(func.count(Space.id)).where(Space.id == entity_id))
        assert int(count or 0) == 1
        assert await db.get(ProcessedSyncOperation, operation_id) is not None
        change = await db.scalar(select(SyncChange).where(SyncChange.operation_id == operation_id))
        assert change is not None
        assert change.sequence == 1
