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
async def test_offline_assessment_and_audit_sync_stays_personal() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.99", 48400)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.100", 48401)),
            base_url=origin,
            headers={"Origin": origin},
        ) as learner,
    ):
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"assessment-sync-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Assessment sync owner",
            },
        )
        learner_registration = await learner.post(
            "/api/v1/auth/register",
            json={
                "email": f"assessment-sync-learner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Assessment sync learner",
            },
        )
        assert owner_registration.status_code == learner_registration.status_code == 201
        learner_id = UUID(learner_registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "Configurable assessment space", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        space_id = UUID(shared.json()["id"])
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=learner_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        async def device(client: AsyncClient) -> UUID:
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(item["id"] for item in devices if item["current"]))

        owner_device, learner_device = await device(owner), await device(learner)

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
            device_id: UUID,
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

        async def push(client: AsyncClient, device_id: UUID, items: list[dict[str, object]]):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/push",
                headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
                json={
                    "message_type": "push_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_id),
                    "sync_epoch": epoch,
                    "operations": items,
                },
            )

        topic_id = uuid4()
        topic_response = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/topics",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"id": str(topic_id), "title": "Assessment topic", "description": ""},
        )
        assert topic_response.status_code == 201
        quiz_id, quiz_op = uuid4(), uuid4()
        quiz_payload = {
            "space_id": str(space_id),
            "topic_id": str(topic_id),
            "prompt": "private assessment prompt",
            "answer_key": "private expected answer",
            "explanation": "private explanation",
            "evaluation_mode": "exact_match",
        }
        quiz_operation = operation(
            owner_device, "quiz_item", quiz_id, quiz_op, "create", 0, quiz_payload
        )
        quiz_push = await push(owner, owner_device, [quiz_operation])
        assert quiz_push.status_code == 200, quiz_push.text
        assert quiz_push.json()["results"][0]["status"] == "applied"

        attempt_id, pattern_id, schedule_id, attempt_op = (
            uuid4(),
            uuid4(),
            uuid4(),
            uuid4(),
        )
        attempt_payload = {
            "space_id": str(space_id),
            "quiz_item_id": str(quiz_id),
            "error_pattern_id": str(pattern_id),
            "schedule_id": str(schedule_id),
            "response_text": "private wrong response",
            "confidence": 5,
            "duration_seconds": 20,
            "self_assessed_correct": None,
            "error_cause": "concept_confusion",
        }
        attempt_operation = operation(
            learner_device,
            "quiz_attempt",
            attempt_id,
            attempt_op,
            "create",
            0,
            attempt_payload,
            [quiz_op],
        )
        attempt_push = await push(learner, learner_device, [attempt_operation])
        assert attempt_push.status_code == 200, attempt_push.text
        assert attempt_push.json()["results"][0]["sequence"] == 4
        replay = await push(learner, learner_device, [attempt_operation])
        assert replay.json()["results"][0]["status"] == "duplicate"

        review_id, review_op = uuid4(), uuid4()
        finding_id, finding_op = uuid4(), uuid4()
        finding_resolve_op, review_complete_op, pattern_resolve_op = (
            uuid4(),
            uuid4(),
            uuid4(),
        )
        review_payload = {
            "space_id": str(space_id),
            "cadence": "daily",
            "period_start": "2026-07-22",
            "period_end": "2026-07-22",
            "summary": "private draft review",
        }
        finding_payload = {
            "space_id": str(space_id),
            "audit_review_id": str(review_id),
            "category": "error_pattern",
            "description": "private review finding",
            "suggested_action": "private next action",
        }
        audit_push = await push(
            learner,
            learner_device,
            [
                operation(
                    learner_device,
                    "audit_review",
                    review_id,
                    review_op,
                    "create",
                    0,
                    review_payload,
                ),
                operation(
                    learner_device,
                    "review_finding",
                    finding_id,
                    finding_op,
                    "create",
                    0,
                    finding_payload,
                    [review_op],
                ),
                operation(
                    learner_device,
                    "review_finding",
                    finding_id,
                    finding_resolve_op,
                    "update",
                    0,
                    {**finding_payload, "action": "resolve", "status": "open"},
                    [finding_op],
                ),
                operation(
                    learner_device,
                    "audit_review",
                    review_id,
                    review_complete_op,
                    "update",
                    0,
                    {**review_payload, "action": "complete", "status": "draft"},
                    [review_op],
                ),
                operation(
                    learner_device,
                    "error_pattern",
                    pattern_id,
                    pattern_resolve_op,
                    "update",
                    1,
                    {
                        "space_id": str(space_id),
                        "action": "resolve",
                        "topic_id": str(topic_id),
                        "cause": "concept_confusion",
                        "occurrence_count": 1,
                        "status": "open",
                        "latest_attempt_id": str(attempt_id),
                    },
                ),
            ],
        )
        assert audit_push.status_code == 200, audit_push.text
        assert [item["status"] for item in audit_push.json()["results"]] == [
            "applied",
            "applied",
            "applied",
            "applied",
            "applied",
        ]

        async def pull(client: AsyncClient, device_id: UUID):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/pull",
                json={
                    "message_type": "pull_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device_id),
                    "sync_epoch": epoch,
                    "cursor": 0,
                    "limit": 100,
                },
            )

        learner_pull = await pull(learner, learner_device)
        learner_changes = learner_pull.json()["changes"]
        by_type = {item["entity_type"]: item for item in learner_changes}
        assert "answer_key" not in by_type["quiz_item"]["payload"]
        assert by_type["quiz_attempt"]["payload"]["answer_key"] == ("private expected answer")
        assert by_type["error_pattern"]["payload"]["status"] == "resolved"
        assert by_type["audit_review"]["payload"]["status"] == "completed"
        assert by_type["review_finding"]["payload"]["status"] == "resolved"

        owner_pull = await pull(owner, owner_device)
        assert owner_pull.json()["next_cursor"] == learner_pull.json()["next_cursor"]
        owner_types = {item["entity_type"] for item in owner_pull.json()["changes"]}
        assert "quiz_item" in owner_types
        assert not owner_types.intersection(
            {"quiz_attempt", "error_pattern", "audit_review", "review_finding"}
        )

        learner_snapshot = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(learner_device),
        )
        learner_snapshot_types = {
            item["entity_type"] for item in learner_snapshot.json()["records"]
        }
        assert {
            "quiz_attempt",
            "error_pattern",
            "audit_review",
            "review_finding",
        }.issubset(learner_snapshot_types)
        owner_snapshot = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(owner_device),
        )
        owner_snapshot_types = {item["entity_type"] for item in owner_snapshot.json()["records"]}
        assert not owner_snapshot_types.intersection(
            {"quiz_attempt", "error_pattern", "audit_review", "review_finding"}
        )
