from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.sync.models import SyncConflictRecord
from logion_api.sync.push import canonical_hash
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_note_resource_sync_replay_conflict_and_bootstrap() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.85", 48005)),
            base_url=origin,
            headers={"Origin": origin},
        ) as client,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.86", 48006)),
            base_url=origin,
            headers={"Origin": origin},
        ) as outsider,
    ):
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
        local_payload = {**update_payload, "markdown_body": "# retained local draft"}
        stale = await push([operation("note", note_id, uuid4(), "update", 1, local_payload)])
        conflict = stale.json()["results"][0]["conflict"]
        assert conflict["resolution_options"] == [
            "keep_local",
            "keep_remote",
            "merge",
            "dismiss",
        ]
        assert (
            await outsider.post(
                "/api/v1/auth/register",
                json={
                    "email": f"conflict-outsider-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "Conflict outsider",
                },
            )
        ).status_code == 201
        outsider_workspace = UUID(
            (await outsider.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        outsider_device = UUID(
            next(
                item["id"]
                for item in (await outsider.get("/api/v1/auth/devices")).json()["devices"]
                if item["current"]
            )
        )
        outsider_bootstrap = await outsider.post(
            f"/api/v1/workspaces/{outsider_workspace}/sync/bootstrap",
            json={
                **bootstrap_body,
                "workspace_id": str(outsider_workspace),
                "device_id": str(outsider_device),
            },
        )
        cross_workspace = {
            **operation("note", note_id, uuid4(), "update", 2, local_payload),
            "workspace_id": str(outsider_workspace),
            "device_id": str(outsider_device),
            "conflict_resolution": {
                "conflict_id": conflict["conflict_id"],
                "resolution": "keep_local",
                "expected_remote_version": 2,
            },
        }
        denied = await outsider.post(
            f"/api/v1/workspaces/{outsider_workspace}/sync/push",
            headers={"X-CSRF-Token": outsider.cookies["logion_csrf"]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(outsider_workspace),
                "device_id": str(outsider_device),
                "sync_epoch": outsider_bootstrap.json()["sync_epoch"],
                "operations": [cross_workspace],
            },
        )
        assert denied.json()["results"][0]["error_code"] == "SYNC_CONFLICT_NOT_FOUND"
        forged = operation("note", note_id, uuid4(), "update", 2, local_payload)
        forged["conflict_resolution"] = {
            "conflict_id": str(uuid4()),
            "resolution": "keep_local",
            "expected_remote_version": 2,
        }
        forged_response = await push([forged])
        assert forged_response.json()["results"][0]["error_code"] == "SYNC_CONFLICT_NOT_FOUND"

        resolution_id = uuid4()
        resolution = operation("note", note_id, resolution_id, "update", 2, local_payload)
        resolution["conflict_resolution"] = {
            "conflict_id": conflict["conflict_id"],
            "resolution": "keep_local",
            "expected_remote_version": 2,
        }
        resolved = await push([resolution])
        assert resolved.json()["results"][0]["server_version"] == 3
        replay = await push([resolution])
        assert replay.json()["results"][0]["status"] == "duplicate"

        async with session_factory() as db:
            record = await db.get(SyncConflictRecord, UUID(conflict["conflict_id"]))
            assert record is not None
            assert record.status == "resolved_local"
            assert record.resolution_operation_id == resolution_id
            audit = await db.scalar(
                select(AuditEvent).where(
                    AuditEvent.workspace_id == workspace_id,
                    AuditEvent.event_type == "sync.conflict.resolved",
                    AuditEvent.target_id == note_id,
                )
            )
            assert audit is not None
            assert audit.event_metadata["conflict_id"] == conflict["conflict_id"]
            assert audit.event_metadata["resolution"] == "keep_local"

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
            and item["payload"]["note_version"] == 3
            for item in snapshot_records
        )
        assert ("resource", str(resource_id)) in records
        assert snapshot.json()["cursor"] == 7
