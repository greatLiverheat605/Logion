import base64
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app
from logion_api.sync.push import canonical_hash
from pycrdt import Doc, Text


def client_insert(state: bytes, index: int, value: str) -> bytes:
    document = Doc({"markdown": Text()})
    document.apply_update(state)
    before = document.get_state()
    document["markdown"].insert(index, value)
    return document.get_update(before)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_two_devices_merge_yjs_note_updates_with_replay_and_tenant_guards() -> None:
    origin = "http://test"
    email = f"yjs-sync-{uuid4()}@example.com"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.111", 49101)),
            base_url=origin,
            headers={"Origin": origin},
        ) as device_a,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.112", 49102)),
            base_url=origin,
            headers={"Origin": origin},
        ) as device_b,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.113", 49103)),
            base_url=origin,
            headers={"Origin": origin},
        ) as outsider,
    ):
        assert (
            await device_a.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "a-strong-password-123",
                    "device_name": "Yjs device A",
                },
            )
        ).status_code == 201
        assert (
            await device_b.post(
                "/api/v1/auth/login",
                json={
                    "email": email,
                    "password": "a-strong-password-123",
                    "device_name": "Yjs device B",
                },
            )
        ).status_code == 200
        assert (
            await outsider.post(
                "/api/v1/auth/register",
                json={
                    "email": f"yjs-outsider-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "Yjs outsider",
                },
            )
        ).status_code == 201

        workspace_id = UUID(
            (await device_a.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        space_id = UUID(
            (await device_a.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0][
                "id"
            ]
        )

        async def current_device(client: AsyncClient) -> UUID:
            rows = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(row["id"] for row in rows if row["current"]))

        device_ids = {
            "a": await current_device(device_a),
            "b": await current_device(device_b),
            "outsider": await current_device(outsider),
        }

        async def bootstrap(client: AsyncClient, device_id: UUID):
            return await client.post(
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

        initial = await bootstrap(device_a, device_ids["a"])
        assert initial.status_code == 200
        epoch = initial.json()["sync_epoch"]
        now = datetime.now(UTC).isoformat()

        def operation(
            device_id: UUID,
            entity_type: str,
            entity_id: UUID,
            operation_id: UUID,
            base_version: int,
            payload: dict[str, object],
        ) -> dict[str, object]:
            return {
                "operation_id": str(operation_id),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "operation_type": "create" if base_version == 0 else "update",
                "base_version": base_version,
                "client_occurred_at": now,
                "payload": payload,
                "payload_hash": canonical_hash(payload),
                "conflict_resolution": None,
                "dependencies": [],
            }

        async def push(client: AsyncClient, device_id: UUID, item: dict[str, object]):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_id),
                    "sync_epoch": epoch,
                    "operations": [item],
                },
            )

        note_id = uuid4()
        initial_markdown = "first\nsecond"
        created_payload = {
            "space_id": str(space_id),
            "task_id": None,
            "title": "Concurrent note",
            "markdown_body": initial_markdown,
        }
        created = await push(
            device_a,
            device_ids["a"],
            operation(device_ids["a"], "note", note_id, uuid4(), 0, created_payload),
        )
        assert created.status_code == 200, created.text
        assert created.json()["results"][0]["status"] == "applied"

        snapshot_b = await bootstrap(device_b, device_ids["b"])
        assert snapshot_b.status_code == 200
        state_record = next(
            row
            for row in snapshot_b.json()["records"]
            if row["entity_type"] == "note_document_state" and row["entity_id"] == str(note_id)
        )
        base_state = base64.b64decode(state_record["payload"]["state_base64"], validate=True)
        base_document = Doc({"markdown": Text()})
        base_document.apply_update(base_state)
        assert str(base_document["markdown"]) == initial_markdown

        left = client_insert(base_state, 5, "-left")
        right = client_insert(base_state, len(initial_markdown), "-right")
        left_payload = {
            "space_id": str(space_id),
            "yjs_generation": 1,
            "update_base64": base64.b64encode(left).decode(),
        }
        right_payload = {
            "space_id": str(space_id),
            "yjs_generation": 1,
            "update_base64": base64.b64encode(right).decode(),
        }
        left_operation = operation(
            device_ids["a"], "note_document_update", note_id, uuid4(), 1, left_payload
        )
        right_id = uuid4()
        right_operation = operation(
            device_ids["b"], "note_document_update", note_id, right_id, 1, right_payload
        )
        left_result = await push(device_a, device_ids["a"], left_operation)
        right_result = await push(device_b, device_ids["b"], right_operation)
        assert left_result.json()["results"][0]["server_version"] == 2
        assert right_result.json()["results"][0]["server_version"] == 3

        duplicate = await push(device_b, device_ids["b"], right_operation)
        assert duplicate.json()["results"][0]["status"] == "duplicate"
        changed = dict(right_operation)
        changed_payload = {**right_payload, "update_base64": base64.b64encode(left).decode()}
        changed["payload"] = changed_payload
        changed["payload_hash"] = canonical_hash(changed_payload)
        changed_replay = await push(device_b, device_ids["b"], changed)
        assert changed_replay.json()["results"][0]["error_code"] == "SYNC_OPERATION_HASH_MISMATCH"

        stale_generation_payload = {**left_payload, "yjs_generation": 2}
        stale_generation = await push(
            device_a,
            device_ids["a"],
            operation(
                device_ids["a"],
                "note_document_update",
                note_id,
                uuid4(),
                1,
                stale_generation_payload,
            ),
        )
        assert (
            stale_generation.json()["results"][0]["error_code"]
            == "SYNC_NOTE_DOCUMENT_GENERATION_CHANGED"
        )

        final_snapshot = await bootstrap(device_a, device_ids["a"])
        note = next(
            row
            for row in final_snapshot.json()["records"]
            if row["entity_type"] == "note" and row["entity_id"] == str(note_id)
        )
        assert "first-left" in note["payload"]["markdown_body"]
        assert "second-right" in note["payload"]["markdown_body"]

        forbidden = await bootstrap(outsider, device_ids["outsider"])
        assert forbidden.status_code in {403, 404}
