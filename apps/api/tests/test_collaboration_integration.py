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

TYPES = ("rubric", "group_review", "group_feedback", "report_snapshot")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_shared_review_role_matrix_and_offline_sync() -> None:
    origin = "http://test"
    clients = [
        AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{140 + index}", 48800 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index in range(4)
    ]
    owner, editor, reviewer, viewer = clients
    try:
        registrations = []
        for client, label in zip(clients, ("owner", "editor", "reviewer", "viewer"), strict=True):
            registrations.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"collaboration-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(result.status_code == 201 for result in registrations), [
            (result.status_code, result.text) for result in registrations
        ]
        user_ids = [UUID(result.json()["user"]["id"]) for result in registrations]
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        csrf = {id(client): client.cookies["logion_csrf"] for client in clients}

        async def create_space(name: str, visibility: str) -> UUID:
            result = await owner.post(
                f"/api/v1/workspaces/{workspace_id}/spaces",
                headers={"X-CSRF-Token": csrf[id(owner)]},
                json={"name": name, "visibility": visibility},
            )
            assert result.status_code == 201, result.text
            return UUID(result.json()["id"])

        shared_id = await create_space("User-created review space", "shared")
        private_id = await create_space("Owner private draft", "private")
        async with session_factory() as db:
            for user_id, role in zip(user_ids[1:], ("editor", "reviewer", "viewer"), strict=True):
                db.add(
                    WorkspaceMembership(
                        workspace_id=workspace_id,
                        user_id=user_id,
                        role=role,
                        status="active",
                        joined_at=datetime.now(UTC),
                    )
                )
            await db.commit()

        base = f"/api/v1/workspaces/{workspace_id}/spaces/{shared_id}/collaboration"
        private_base = f"/api/v1/workspaces/{workspace_id}/spaces/{private_id}/collaboration"
        rubric_id, review_id, report_id, feedback_id = (uuid4() for _ in range(4))
        rubric = {
            "id": str(rubric_id),
            "title": "Explicit rubric",
            "criteria": "Private rubric text",
        }
        review = {
            "id": str(review_id),
            "rubric_id": str(rubric_id),
            "subject_title": "Explicit submission",
            "submission_summary": "Private submission text",
        }
        report = {
            "id": str(report_id),
            "review_id": str(review_id),
            "summary": "Private report text",
            "published_at": datetime.now(UTC).isoformat(),
        }
        feedback = {
            "id": str(feedback_id),
            "review_id": str(review_id),
            "feedback": "Private feedback text",
            "recommended_action": "Private action text",
        }

        missing_csrf = await owner.post(f"{base}/rubrics", json=rubric)
        assert missing_csrf.status_code == 403
        private_write = await owner.post(
            f"{private_base}/rubrics",
            headers={"X-CSRF-Token": csrf[id(owner)]},
            json=rubric,
        )
        assert private_write.status_code == 403

        for path, payload in (("rubrics", rubric), ("reviews", review), ("reports", report)):
            result = await editor.post(
                f"{base}/{path}",
                headers={"X-CSRF-Token": csrf[id(editor)]},
                json=payload,
            )
            assert result.status_code == 201, result.text
        reviewer_feedback = await reviewer.post(
            f"{base}/feedback",
            headers={"X-CSRF-Token": csrf[id(reviewer)]},
            json=feedback,
        )
        assert reviewer_feedback.status_code == 201, reviewer_feedback.text

        for path, payload in (
            ("rubrics", {**rubric, "id": str(uuid4())}),
            ("reports", {**report, "id": str(uuid4())}),
        ):
            denied = await reviewer.post(
                f"{base}/{path}",
                headers={"X-CSRF-Token": csrf[id(reviewer)]},
                json=payload,
            )
            assert denied.status_code == 403
        for path, payload in (
            ("rubrics", {**rubric, "id": str(uuid4())}),
            ("feedback", {**feedback, "id": str(uuid4())}),
        ):
            denied = await viewer.post(
                f"{base}/{path}",
                headers={"X-CSRF-Token": csrf[id(viewer)]},
                json=payload,
            )
            assert denied.status_code == 403

        visible = await viewer.get(base)
        assert visible.status_code == 200
        assert [
            len(visible.json()[key]) for key in ("rubrics", "reviews", "feedback", "reports")
        ] == [1, 1, 1, 1]
        assert (await viewer.get(private_base)).status_code == 403
        assert (
            await editor.patch(f"{base}/reports/{report_id}", json={"summary": "changed"})
        ).status_code in {404, 405}

        async def device_id(client: AsyncClient) -> UUID:
            rows = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(row["id"] for row in rows if row["current"]))

        devices = [await device_id(client) for client in clients]

        async def bootstrap(client: AsyncClient, device: UUID):
            return await client.post(
                f"/api/v1/workspaces/{workspace_id}/sync/bootstrap",
                json={
                    "message_type": "bootstrap_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": str(workspace_id),
                    "device_id": str(device),
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )

        editor_boot = await bootstrap(editor, devices[1])
        reviewer_boot = await bootstrap(reviewer, devices[2])
        assert editor_boot.status_code == reviewer_boot.status_code == 200
        offline_ids = {kind: uuid4() for kind in TYPES}
        operation_ids = {kind: uuid4() for kind in TYPES}
        now = datetime.now(UTC).isoformat()
        payloads = {
            "rubric": {
                "space_id": str(shared_id),
                "title": "Offline rubric",
                "criteria": "Offline criteria",
            },
            "group_review": {
                "space_id": str(shared_id),
                "rubric_id": str(offline_ids["rubric"]),
                "subject_title": "Offline submission",
                "submission_summary": "Offline submission summary",
            },
            "report_snapshot": {
                "space_id": str(shared_id),
                "review_id": str(offline_ids["group_review"]),
                "summary": "Offline report",
                "published_at": now,
            },
            "group_feedback": {
                "space_id": str(shared_id),
                "review_id": str(offline_ids["group_review"]),
                "feedback": "Offline feedback",
                "recommended_action": "Offline action",
            },
        }

        def operation(kind: str, device: UUID, dependencies: list[UUID]):
            raw = payloads[kind]
            return {
                "operation_id": str(operation_ids[kind]),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device),
                "entity_type": kind,
                "entity_id": str(offline_ids[kind]),
                "operation_type": "create",
                "base_version": 0,
                "client_occurred_at": now,
                "payload": raw,
                "payload_hash": canonical_hash(raw),
                "dependencies": [str(value) for value in dependencies],
            }

        editor_operations = [
            operation("rubric", devices[1], []),
            operation("group_review", devices[1], [operation_ids["rubric"]]),
            operation("report_snapshot", devices[1], [operation_ids["group_review"]]),
        ]
        editor_push = await editor.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf[id(editor)]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(devices[1]),
                "sync_epoch": editor_boot.json()["sync_epoch"],
                "operations": editor_operations,
            },
        )
        assert editor_push.status_code == 200, editor_push.text
        assert all(row["status"] == "applied" for row in editor_push.json()["results"])
        reviewer_push = await reviewer.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf[id(reviewer)]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(devices[2]),
                "sync_epoch": reviewer_boot.json()["sync_epoch"],
                "operations": [operation("group_feedback", devices[2], [])],
            },
        )
        assert reviewer_push.json()["results"][0]["status"] == "applied"

        viewer_boot = await bootstrap(viewer, devices[3])
        viewer_types = {row["entity_type"] for row in viewer_boot.json()["records"]}
        assert set(TYPES).issubset(viewer_types)
        viewer_operation = operation("rubric", devices[3], [])
        viewer_operation["operation_id"] = str(uuid4())
        viewer_operation["entity_id"] = str(uuid4())
        viewer_push = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": csrf[id(viewer)]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(devices[3]),
                "sync_epoch": viewer_boot.json()["sync_epoch"],
                "operations": [viewer_operation],
            },
        )
        assert viewer_push.json()["results"][0]["status"] == "rejected"

        async with session_factory() as db:
            audit_text = " ".join(
                str(row.event_metadata)
                for row in (
                    await db.scalars(
                        select(AuditEvent).where(AuditEvent.workspace_id == workspace_id)
                    )
                ).all()
            )
        for secret in (
            "Private rubric text",
            "Private submission text",
            "Private feedback text",
            "Private report text",
        ):
            assert secret not in audit_text
    finally:
        for client in clients:
            await client.aclose()
