from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import WorkspaceMembership


@pytest.mark.integration
@pytest.mark.asyncio
async def test_offline_topic_mastery_review_sync_and_personal_visibility() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.95", 48210)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.96", 48211)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"memory-sync-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Memory sync owner",
            },
        )
        viewer_registration = await viewer.post(
            "/api/v1/auth/register",
            json={
                "email": f"memory-sync-viewer-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Memory sync viewer",
            },
        )
        assert owner_registration.status_code == viewer_registration.status_code == 201
        viewer_id = UUID(viewer_registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "Shared memory graph", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space_id = UUID(shared.json()["id"])

        async def current_device(client: AsyncClient) -> UUID:
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(item["id"] for item in devices if item["current"]))

        owner_device = await current_device(owner)
        viewer_device = await current_device(viewer)
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=viewer_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        def bootstrap_body(device_id: UUID) -> dict[str, object]:
            return {
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            }

        initial = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(owner_device),
        )
        epoch = initial.json()["sync_epoch"]
        now = datetime.now(UTC).isoformat()

        def operation(
            entity_type: str,
            entity_id: UUID,
            operation_id: UUID,
            kind: str,
            base: int,
            payload: dict[str, object],
            dependencies: list[UUID] | None = None,
        ) -> dict[str, object]:
            return {
                "operation_id": str(operation_id),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(owner_device),
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "operation_type": kind,
                "base_version": base,
                "client_occurred_at": now,
                "payload": payload,
                "payload_hash": canonical_hash(payload),
                "dependencies": [str(item) for item in dependencies or []],
            }

        async def push(items: list[dict[str, object]]):
            return await owner.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(owner_device),
                    "sync_epoch": epoch,
                    "operations": items,
                },
            )

        topic_a, topic_b = uuid4(), uuid4()
        topic_a_op, topic_b_op, dependency_op = uuid4(), uuid4(), uuid4()
        topic_a_payload = {
            "space_id": str(space_id),
            "title": "Private topic A",
            "description": "private topic details",
        }
        graph = await push(
            [
                operation("topic", topic_a, topic_a_op, "create", 0, topic_a_payload),
                operation(
                    "topic",
                    topic_b,
                    topic_b_op,
                    "create",
                    0,
                    {"space_id": str(space_id), "title": "Private topic B", "description": ""},
                ),
                operation(
                    "topic_dependency",
                    uuid4(),
                    dependency_op,
                    "create",
                    0,
                    {
                        "space_id": str(space_id),
                        "prerequisite_topic_id": str(topic_a),
                        "dependent_topic_id": str(topic_b),
                    },
                    [topic_a_op, topic_b_op],
                ),
            ]
        )
        assert graph.status_code == 200, graph.text
        assert [item["status"] for item in graph.json()["results"]] == [
            "applied",
            "applied",
            "applied",
        ]

        mastery_id, schedule_id, first_mastery_op = uuid4(), uuid4(), uuid4()
        first_payload = {
            "space_id": str(space_id),
            "topic_id": str(topic_a),
            "action": "confirm",
            "schedule_id": str(schedule_id),
            "suggested_level": "unknown",
            "suggested_reason": "",
            "suggested_at": None,
            "confirmed_level": "exposed",
            "confirmed_at": None,
        }
        first_operation = operation(
            "mastery",
            mastery_id,
            first_mastery_op,
            "create",
            0,
            first_payload,
            [topic_a_op],
        )
        first = await push([first_operation])
        assert first.status_code == 200, first.text
        assert first.json()["results"][0]["sequence"] == 5
        replay = await push([first_operation])
        assert replay.json()["results"][0]["status"] == "duplicate"

        second_payload = {**first_payload, "confirmed_level": "familiar"}
        second = await push(
            [
                operation(
                    "mastery",
                    mastery_id,
                    uuid4(),
                    "update",
                    0,
                    second_payload,
                    [first_mastery_op],
                )
            ]
        )
        assert second.status_code == 200, second.text
        assert second.json()["results"][0]["server_version"] == 2

        owner_snapshot = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(owner_device),
        )
        owner_records = {
            (item["entity_type"], item["entity_id"]): item
            for item in owner_snapshot.json()["records"]
        }
        assert owner_snapshot.json()["cursor"] == 7
        assert owner_records[("topic", str(topic_a))]["payload"]["description"] == (
            "private topic details"
        )
        assert owner_records[("mastery", str(mastery_id))]["payload"][
            "confirmed_level"
        ] == "familiar"
        assert owner_records[("review_schedule", str(schedule_id))]["payload"][
            "interval_days"
        ] == 4

        viewer_snapshot = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(viewer_device),
        )
        viewer_types = {item["entity_type"] for item in viewer_snapshot.json()["records"]}
        assert {"topic", "topic_dependency"}.issubset(viewer_types)
        assert "mastery" not in viewer_types
        assert "review_schedule" not in viewer_types

        foreign_mastery = operation(
            "mastery",
            mastery_id,
            uuid4(),
            "create",
            0,
            {**first_payload, "schedule_id": str(uuid4())},
        )
        foreign_mastery["device_id"] = str(viewer_device)
        viewer_write = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(viewer_device),
                "sync_epoch": epoch,
                "operations": [foreign_mastery],
            },
        )
        assert viewer_write.status_code == 200, viewer_write.text
        assert viewer_write.json()["results"][0] == {
            "operation_id": foreign_mastery["operation_id"],
            "status": "rejected",
            "retryable": False,
            "error_code": "SYNC_OPERATION_FORBIDDEN",
        }

        viewer_pull = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull",
            json={
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(viewer_device),
                "sync_epoch": epoch,
                "cursor": 0,
                "limit": 100,
            },
        )
        assert viewer_pull.json()["next_cursor"] == 7
        assert {item["entity_type"] for item in viewer_pull.json()["changes"]} == {
            "topic",
            "topic_dependency",
        }

        stale = await push(
            [
                operation(
                    "mastery",
                    mastery_id,
                    uuid4(),
                    "update",
                    1,
                    second_payload,
                )
            ]
        )
        assert stale.json()["results"][0]["status"] == "conflict"
