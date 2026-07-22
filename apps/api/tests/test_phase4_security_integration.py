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
async def test_phase4_guessed_ids_never_disclose_personal_or_private_content() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.150", 48900)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.151", 48901)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        owner_registration = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"phase4-owner-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "owner",
            },
        )
        viewer_registration = await viewer.post(
            "/api/v1/auth/register",
            json={
                "email": f"phase4-viewer-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "viewer",
            },
        )
        assert owner_registration.status_code == viewer_registration.status_code == 201
        viewer_id = UUID(viewer_registration.json()["user"]["id"])
        owner_workspace = UUID(
            (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        viewer_workspace = UUID(
            (await viewer.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        owner_csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        viewer_csrf = {"X-CSRF-Token": viewer.cookies["logion_csrf"]}

        async def create_space(name: str, visibility: str) -> UUID:
            response = await owner.post(
                f"/api/v1/workspaces/{owner_workspace}/spaces",
                headers=owner_csrf,
                json={"name": name, "visibility": visibility},
            )
            assert response.status_code == 201, response.text
            return UUID(response.json()["id"])

        shared_id = await create_space("User supplied shared context", "shared")
        private_id = await create_space("Owner private context", "private")
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=owner_workspace,
                    user_id=viewer_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        exam_id, track_id, paper_id, rubric_id = (uuid4() for _ in range(4))
        exam_endpoint = f"/api/v1/workspaces/{owner_workspace}/spaces/{shared_id}/exams"
        self_study_base = f"/api/v1/workspaces/{owner_workspace}/spaces/{shared_id}/self-study"
        research_base = f"/api/v1/workspaces/{owner_workspace}/spaces/{shared_id}/research"
        collaboration_base = (
            f"/api/v1/workspaces/{owner_workspace}/spaces/{shared_id}/collaboration"
        )
        victim_payloads = {
            "exam": {
                "id": str(exam_id),
                "title": "victim secret exam",
                "date_status": "unscheduled",
                "exam_at": None,
                "timezone": "UTC",
                "target_score": None,
                "score_scale_max": 100,
            },
            "learning_track": {
                "id": str(track_id),
                "title": "victim secret track",
                "objective": "victim secret objective",
            },
            "paper_record": {
                "id": str(paper_id),
                "title": "victim secret paper",
                "citation_key": "victim-secret-citation",
                "source_url": None,
            },
            "rubric": {
                "id": str(rubric_id),
                "title": "shared rubric",
                "criteria": "victim secret rubric criteria",
            },
        }
        writes = (
            (exam_endpoint, victim_payloads["exam"]),
            (f"{self_study_base}/tracks", victim_payloads["learning_track"]),
            (f"{research_base}/papers", victim_payloads["paper_record"]),
            (f"{collaboration_base}/rubrics", victim_payloads["rubric"]),
        )
        for endpoint, payload in writes:
            response = await owner.post(endpoint, headers=owner_csrf, json=payload)
            assert response.status_code == 201, response.text

        assert (await viewer.get(exam_endpoint)).json()["exams"] == []
        assert (await viewer.get(self_study_base)).json()["tracks"] == []
        assert (await viewer.get(research_base)).json()["papers"] == []
        assert len((await viewer.get(collaboration_base)).json()["rubrics"]) == 1
        assert (
            await viewer.get(
                f"/api/v1/workspaces/{owner_workspace}/spaces/{private_id}/collaboration"
            )
        ).status_code == 404
        assert (await owner.get(f"/api/v1/workspaces/{viewer_workspace}/spaces")).status_code == 404

        devices = (await viewer.get("/api/v1/auth/devices")).json()["devices"]
        viewer_device = UUID(next(row["id"] for row in devices if row["current"]))
        bootstrap = await viewer.post(
            f"/api/v1/workspaces/{owner_workspace}/sync/bootstrap",
            json={
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(owner_workspace),
                "device_id": str(viewer_device),
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            },
        )
        assert bootstrap.status_code == 200, bootstrap.text
        bootstrap_types = {row["entity_type"] for row in bootstrap.json()["records"]}
        assert "rubric" in bootstrap_types
        assert {"exam", "learning_track", "paper_record"}.isdisjoint(bootstrap_types)

        attacker_payloads = {
            "exam": {
                "space_id": str(shared_id),
                "title": "attacker exam",
                "date_status": "unscheduled",
                "exam_at": None,
                "timezone": "UTC",
                "target_score": None,
                "score_scale_max": 100,
                "status": "planning",
            },
            "learning_track": {
                "space_id": str(shared_id),
                "title": "attacker track",
                "objective": "attacker objective",
            },
            "paper_record": {
                "space_id": str(shared_id),
                "title": "attacker paper",
                "citation_key": "attacker-citation",
                "source_url": None,
            },
            "rubric": {
                "space_id": str(shared_id),
                "title": "attacker rubric",
                "criteria": "attacker criteria",
            },
        }
        entity_ids = {
            "exam": exam_id,
            "learning_track": track_id,
            "paper_record": paper_id,
            "rubric": rubric_id,
        }
        now = datetime.now(UTC).isoformat()
        operations = []
        for entity_type, payload in attacker_payloads.items():
            operations.append(
                {
                    "operation_id": str(uuid4()),
                    "protocol_version": "sync-v1",
                    "workspace_id": str(owner_workspace),
                    "device_id": str(viewer_device),
                    "entity_type": entity_type,
                    "entity_id": str(entity_ids[entity_type]),
                    "operation_type": "create",
                    "base_version": 0,
                    "client_occurred_at": now,
                    "payload": payload,
                    "payload_hash": canonical_hash(payload),
                    "dependencies": [],
                }
            )
        attack = await viewer.post(
            f"/api/v1/workspaces/{owner_workspace}/sync/push",
            headers=viewer_csrf,
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(owner_workspace),
                "device_id": str(viewer_device),
                "sync_epoch": bootstrap.json()["sync_epoch"],
                "operations": operations,
            },
        )
        assert attack.status_code == 200, attack.text
        assert [row["status"] for row in attack.json()["results"]] == [
            "rejected",
            "rejected",
            "rejected",
            "rejected",
        ]
        serialized = attack.text
        for secret in (
            "victim secret exam",
            "victim secret track",
            "victim secret objective",
            "victim secret paper",
            "victim secret rubric criteria",
        ):
            assert secret not in serialized
