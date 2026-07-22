from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.sync.push import canonical_hash
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_personal_exam_rest_and_sync_are_owner_only() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.110", 48500)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.111", 48501)),
            base_url=origin,
            headers={"Origin": origin},
        ) as learner,
    ):
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"exam-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Exam owner",
            },
        )
        learner_registration = await learner.post(
            "/api/v1/auth/register",
            json={
                "email": f"exam-learner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Exam learner",
            },
        )
        assert owner_registration.status_code == learner_registration.status_code == 201
        learner_id = UUID(learner_registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "User configured exam space", "visibility": "shared"},
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

        endpoint = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/exams"
        private_title = "Private user supplied exam title"
        private_date = "2026-09-05T01:00:00Z"
        without_csrf = await owner.post(
            endpoint,
            json={
                "id": str(uuid4()),
                "title": private_title,
                "date_status": "scheduled",
                "exam_at": private_date,
                "timezone": "Asia/Shanghai",
            },
        )
        assert without_csrf.status_code == 403
        rest_exam_id = uuid4()
        created = await owner.post(
            endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(rest_exam_id),
                "title": private_title,
                "date_status": "scheduled",
                "exam_at": private_date,
                "timezone": "Asia/Shanghai",
                "target_score": 85,
                "score_scale_max": 100,
            },
        )
        assert created.status_code == 201, created.text
        assert [item["id"] for item in (await owner.get(endpoint)).json()["exams"]] == [
            str(rest_exam_id)
        ]
        learner_list = await learner.get(endpoint)
        assert learner_list.status_code == 200
        assert learner_list.json()["exams"] == []

        subject_id = uuid4()
        subject_endpoint = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/exam-subjects"
        subject = await owner.post(
            subject_endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(subject_id),
                "exam_id": str(rest_exam_id),
                "name": "Private user supplied subject",
                "weight_basis_points": 2500,
            },
        )
        assert subject.status_code == 201, subject.text
        assert (await learner.get(subject_endpoint)).json()["subjects"] == []
        node_id = uuid4()
        node_endpoint = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/syllabus-nodes"
        node = await owner.post(
            node_endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(node_id),
                "subject_id": str(subject_id),
                "parent_id": None,
                "title": "Private syllabus node",
                "importance": 5,
            },
        )
        assert node.status_code == 201, node.text
        assert (await learner.get(node_endpoint)).json()["nodes"] == []
        mock_id = uuid4()
        mock_endpoint = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/mock-exams"
        mock = await owner.post(
            mock_endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(mock_id),
                "exam_id": str(rest_exam_id),
                "title": "Private mock title",
                "duration_limit_seconds": 7200,
            },
        )
        assert mock.status_code == 201, mock.text
        assert (await learner.get(mock_endpoint)).json()["mock_exams"] == []
        score_id = uuid4()
        score_endpoint = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/score-records"
        score = await owner.post(
            score_endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(score_id),
                "mock_exam_id": str(mock_id),
                "score": 80,
                "score_scale_max": 100,
                "duration_seconds": 6900,
                "completed_at": datetime.now(UTC).isoformat(),
            },
        )
        assert score.status_code == 201, score.text
        assert (await learner.get(score_endpoint)).json()["score_records"] == []

        async def current_device(client: AsyncClient) -> UUID:
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(item["id"] for item in devices if item["current"]))

        owner_device = await current_device(owner)
        learner_device = await current_device(learner)

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

        owner_bootstrap = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(owner_device),
        )
        learner_bootstrap = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
            json=bootstrap_body(learner_device),
        )
        assert any(
            record["entity_type"] == "exam" and record["entity_id"] == str(rest_exam_id)
            for record in owner_bootstrap.json()["records"]
        )
        assert any(
            record["entity_type"] == "exam_subject" and record["entity_id"] == str(subject_id)
            for record in owner_bootstrap.json()["records"]
        )
        assert any(
            record["entity_type"] == "syllabus_node" and record["entity_id"] == str(node_id)
            for record in owner_bootstrap.json()["records"]
        )
        assert any(
            record["entity_type"] == "mock_exam" for record in owner_bootstrap.json()["records"]
        )
        assert any(
            record["entity_type"] == "score_record" for record in owner_bootstrap.json()["records"]
        )
        assert not any(
            record["entity_type"]
            in {"exam", "exam_subject", "syllabus_node", "mock_exam", "score_record"}
            for record in learner_bootstrap.json()["records"]
        )
        epoch = learner_bootstrap.json()["sync_epoch"]
        exam_id, operation_id = uuid4(), uuid4()
        payload = {
            "space_id": str(space_id),
            "title": "Learner private offline exam",
            "date_status": "undetermined",
            "exam_at": None,
            "timezone": None,
            "target_score": None,
            "score_scale_max": None,
            "status": "planning",
        }
        operation = {
            "operation_id": str(operation_id),
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(learner_device),
            "entity_type": "exam",
            "entity_id": str(exam_id),
            "operation_type": "create",
            "base_version": 0,
            "client_occurred_at": datetime.now(UTC).isoformat(),
            "payload": payload,
            "payload_hash": canonical_hash(payload),
            "dependencies": [],
        }
        push_body = {
            "message_type": "push_request",
            "protocol_version": "sync-v1",
            "workspace_id": str(workspace_id),
            "device_id": str(learner_device),
            "sync_epoch": epoch,
            "operations": [operation],
        }
        pushed = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json=push_body,
        )
        assert pushed.status_code == 200, pushed.text
        assert pushed.json()["results"][0]["status"] == "applied"
        replayed = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json=push_body,
        )
        assert replayed.status_code == 200
        assert replayed.json()["results"][0]["status"] == "duplicate"

        offline_subject_id, subject_operation_id = uuid4(), uuid4()
        subject_payload = {
            "space_id": str(space_id),
            "exam_id": str(exam_id),
            "name": "Learner private offline subject",
            "weight_basis_points": 5000,
            "status": "active",
        }
        subject_operation = {
            **operation,
            "operation_id": str(subject_operation_id),
            "entity_type": "exam_subject",
            "entity_id": str(offline_subject_id),
            "payload": subject_payload,
            "payload_hash": canonical_hash(subject_payload),
            "dependencies": [str(operation_id)],
        }
        offline_node_id, node_operation_id = uuid4(), uuid4()
        node_payload = {
            "space_id": str(space_id),
            "subject_id": str(offline_subject_id),
            "parent_id": None,
            "title": "Learner private offline syllabus node",
            "importance": 4,
            "coverage_status": "not_started",
        }
        node_operation = {
            **operation,
            "operation_id": str(node_operation_id),
            "entity_type": "syllabus_node",
            "entity_id": str(offline_node_id),
            "payload": node_payload,
            "payload_hash": canonical_hash(node_payload),
            "dependencies": [str(subject_operation_id)],
        }
        hierarchy_push = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={**push_body, "operations": [subject_operation, node_operation]},
        )
        assert hierarchy_push.status_code == 200, hierarchy_push.text
        assert [item["status"] for item in hierarchy_push.json()["results"]] == [
            "applied",
            "applied",
        ]
        offline_mock_id, mock_operation_id = uuid4(), uuid4()
        mock_payload = {
            "space_id": str(space_id),
            "exam_id": str(exam_id),
            "title": "Learner private offline mock",
            "duration_limit_seconds": 5400,
        }
        mock_operation = {
            **operation,
            "operation_id": str(mock_operation_id),
            "entity_type": "mock_exam",
            "entity_id": str(offline_mock_id),
            "payload": mock_payload,
            "payload_hash": canonical_hash(mock_payload),
            "dependencies": [str(operation_id)],
        }
        offline_score_id, score_operation_id = uuid4(), uuid4()
        score_payload = {
            "space_id": str(space_id),
            "mock_exam_id": str(offline_mock_id),
            "score": 75,
            "score_scale_max": 100,
            "duration_seconds": 5000,
            "completed_at": datetime.now(UTC).isoformat(),
        }
        score_operation = {
            **operation,
            "operation_id": str(score_operation_id),
            "entity_type": "score_record",
            "entity_id": str(offline_score_id),
            "payload": score_payload,
            "payload_hash": canonical_hash(score_payload),
            "dependencies": [str(mock_operation_id)],
        }
        score_push = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={**push_body, "operations": [mock_operation, score_operation]},
        )
        assert score_push.status_code == 200, score_push.text
        assert [item["status"] for item in score_push.json()["results"]] == ["applied", "applied"]
        foreign_parent = await owner.post(
            node_endpoint,
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(uuid4()),
                "subject_id": str(offline_subject_id),
                "parent_id": str(offline_node_id),
                "title": "Must not be accepted",
                "importance": 3,
            },
        )
        assert foreign_parent.status_code == 404

        def pull_body(device_id: UUID) -> dict[str, object]:
            return {
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "sync_epoch": epoch,
                "cursor": 0,
                "limit": 100,
            }

        learner_pull = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull",
            json=pull_body(learner_device),
        )
        owner_pull = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull",
            json=pull_body(owner_device),
        )
        personal_ids = {
            str(exam_id),
            str(offline_subject_id),
            str(offline_node_id),
            str(offline_mock_id),
            str(offline_score_id),
        }
        assert personal_ids.issubset(
            {change["entity_id"] for change in learner_pull.json()["changes"]}
        )
        assert not any(
            change["entity_id"] in personal_ids for change in owner_pull.json()["changes"]
        )
        assert owner_pull.json()["next_cursor"] >= score_push.json()["results"][-1]["sequence"]

    async with session_factory() as db:
        audits = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        serialized = " ".join(str(item.event_metadata) for item in audits)
        assert private_title not in serialized
        assert private_date not in serialized
        assert "Private user supplied subject" not in serialized
        assert "Private syllabus node" not in serialized
        assert "Learner private offline subject" not in serialized
        assert "Learner private offline syllabus node" not in serialized
        assert "Private mock title" not in serialized
        assert "Learner private offline mock" not in serialized
        assert all(
            {"title", "exam_at", "timezone", "target_score", "score_scale_max"}.isdisjoint(
                item.event_metadata
            )
            for item in audits
        )
