from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app
from logion_api.sync.push import canonical_hash


@pytest.mark.integration
@pytest.mark.asyncio
async def test_note_resource_sync_replay_conflict_and_bootstrap() -> None:
    origin = "http://test"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("192.0.2.85", 48005)),
        base_url=origin,
        headers={"Origin": origin},
    ) as client:
        assert (
            await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"content-sync-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "Content sync device",
                },
            )
        ).status_code == 201
        csrf = client.cookies["logion_csrf"]
        workspace_id = UUID((await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )
        device_id = UUID(
            next(
                item["id"]
                for item in (await client.get("/api/v1/auth/devices")).json()["devices"]
                if item["current"]
            )
        )
        bootstrap_body = {
            "message_type": "bootstrap_request",
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(device_id),
            "known_sync_epoch": None,
            "snapshot_id": None,
            "chunk_index": None,
        }
        initial = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_body
        )
        epoch = initial.json()["sync_epoch"]
        now = datetime.now(UTC).isoformat()

        def operation(entity_type, entity_id, operation_id, kind, base, payload, dependencies=None):
            return {
                "operation_id": str(operation_id),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "operation_type": kind,
                "base_version": base,
                "client_occurred_at": now,
                "payload": payload,
                "payload_hash": canonical_hash(payload),
                "dependencies": [str(item) for item in dependencies or []],
            }

        async def push(items):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": csrf},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_id),
                    "sync_epoch": epoch,
                    "operations": items,
                },
            )

        note_id, create_id = uuid4(), uuid4()
        created_payload = {
            "space_id": str(space_id),
            "task_id": None,
            "title": "Offline note",
            "markdown_body": "# private draft",
        }
        created = await push([operation("note", note_id, create_id, "create", 0, created_payload)])
        assert created.status_code == 200, created.text
        update_payload = {**created_payload, "markdown_body": "# revised private draft"}
        updated = await push(
            [operation("note", note_id, uuid4(), "update", 0, update_payload, [create_id])]
        )
        assert updated.json()["results"][0]["server_version"] == 2
        stale = await push([operation("note", note_id, uuid4(), "update", 1, update_payload)])
        assert stale.json()["results"][0]["status"] == "conflict"

        resource_id = uuid4()
        resource_payload = {
            "space_id": str(space_id),
            "task_id": None,
            "resource_type": "link",
            "title": "Reference",
            "source_url": "https://example.com/reference",
            "pdf_filename": None,
            "page_count": None,
            "sha256": None,
            "page_index": [],
        }
        resource = await push(
            [operation("resource", resource_id, uuid4(), "create", 0, resource_payload)]
        )
        assert resource.json()["results"][0]["status"] == "applied"
        snapshot = await client.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_body
        )
        snapshot_records = snapshot.json()["records"]
        records = {(item["entity_type"], item["entity_id"]) for item in snapshot_records}
        assert ("note", str(note_id)) in records
        assert any(
            item["entity_type"] == "note_document_state"
            and item["payload"]["note_id"] == str(note_id)
            and item["payload"]["note_version"] == 2
            for item in snapshot_records
        )
        assert ("resource", str(resource_id)) in records
        assert snapshot.json()["cursor"] == 5
