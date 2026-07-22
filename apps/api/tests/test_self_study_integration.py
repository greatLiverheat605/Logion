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
async def test_self_study_loop_is_personal_online_and_offline() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.120", 48600)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.121", 48601)),
            base_url=origin,
            headers={"Origin": origin},
        ) as learner,
    ):

        async def register(client: AsyncClient, label: str):
            return await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"self-study-{label}-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": label,
                },
            )

        owner_registration, learner_registration = (
            await register(owner, "owner"),
            await register(learner, "learner"),
        )
        assert owner_registration.status_code == learner_registration.status_code == 201
        learner_id = UUID(learner_registration.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "User configured study space", "visibility": "shared"},
        )
        assert shared.status_code == 201
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
        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/self-study"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        no_csrf = await owner.post(f"{base}/tracks", json={"id": str(uuid4()), "title": "x"})
        assert no_csrf.status_code == 403
        track_id, project_id, inbox_id, deliverable_id = uuid4(), uuid4(), uuid4(), uuid4()
        writes = [
            (
                "tracks",
                {"id": str(track_id), "title": "Private track", "objective": "Private objective"},
            ),
            (
                "projects",
                {
                    "id": str(project_id),
                    "track_id": str(track_id),
                    "title": "Private project",
                    "intended_outcome": "Private outcome",
                },
            ),
            ("inbox", {"id": str(inbox_id), "title": "Private inbox", "note": "Private note"}),
            (
                "deliverables",
                {
                    "id": str(deliverable_id),
                    "project_id": str(project_id),
                    "title": "Private result",
                    "evidence_summary": "Private evidence",
                    "completed_at": datetime.now(UTC).isoformat(),
                },
            ),
        ]
        for path, payload in writes:
            response = await owner.post(f"{base}/{path}", headers=csrf, json=payload)
            assert response.status_code == 201, response.text
        owner_list, learner_list = await owner.get(base), await learner.get(base)
        assert owner_list.status_code == learner_list.status_code == 200
        assert len(owner_list.json()["tracks"]) == 1
        assert learner_list.json() == {
            "tracks": [],
            "projects": [],
            "inbox_items": [],
            "deliverables": [],
        }

        async def device(client: AsyncClient) -> UUID:
            rows = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(row["id"] for row in rows if row["current"]))

        owner_device, learner_device = await device(owner), await device(learner)

        def bootstrap_body(device_id: UUID):
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
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_body(owner_device)
        )
        learner_bootstrap = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=bootstrap_body(learner_device)
        )
        personal_types = {"learning_track", "study_project", "inbox_item", "deliverable"}
        assert personal_types.issubset(
            {x["entity_type"] for x in owner_bootstrap.json()["records"]}
        )
        assert personal_types.isdisjoint(
            {x["entity_type"] for x in learner_bootstrap.json()["records"]}
        )
        epoch = learner_bootstrap.json()["sync_epoch"]
        now = datetime.now(UTC).isoformat()
        ids = {kind: uuid4() for kind in personal_types}
        operation_ids = {kind: uuid4() for kind in personal_types}
        payloads = {
            "learning_track": {
                "space_id": str(space_id),
                "title": "Offline track",
                "objective": "Offline objective",
            },
            "study_project": {
                "space_id": str(space_id),
                "track_id": str(ids["learning_track"]),
                "title": "Offline project",
                "intended_outcome": "Offline outcome",
            },
            "inbox_item": {
                "space_id": str(space_id),
                "title": "Offline inbox",
                "note": "Offline note",
            },
            "deliverable": {
                "space_id": str(space_id),
                "project_id": str(ids["study_project"]),
                "title": "Offline result",
                "evidence_summary": "Offline evidence",
                "completed_at": now,
            },
        }
        dependencies = {
            "learning_track": [],
            "inbox_item": [],
            "study_project": [operation_ids["learning_track"]],
            "deliverable": [operation_ids["study_project"]],
        }
        operations = [
            {
                "operation_id": str(operation_ids[kind]),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(learner_device),
                "entity_type": kind,
                "entity_id": str(ids[kind]),
                "operation_type": "create",
                "base_version": 0,
                "client_occurred_at": now,
                "payload": payloads[kind],
                "payload_hash": canonical_hash(payloads[kind]),
                "dependencies": [str(x) for x in dependencies[kind]],
            }
            for kind in ("learning_track", "study_project", "inbox_item", "deliverable")
        ]
        pushed = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(learner_device),
                "sync_epoch": epoch,
                "operations": operations,
            },
        )
        assert pushed.status_code == 200, pushed.text
        assert all(x["status"] == "applied" for x in pushed.json()["results"])

        def pull_body(device_id: UUID):
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
            f"/api/v1/workspaces/{workspace_id}/sync/pull", json=pull_body(learner_device)
        )
        owner_pull = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull", json=pull_body(owner_device)
        )
        private_ids = {str(x) for x in ids.values()}
        assert private_ids.issubset({x["entity_id"] for x in learner_pull.json()["changes"]})
        assert private_ids.isdisjoint({x["entity_id"] for x in owner_pull.json()["changes"]})
        assert owner_pull.json()["next_cursor"] >= pushed.json()["results"][-1]["sequence"]

    async with session_factory() as db:
        audits = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        serialized = " ".join(str(x.event_metadata) for x in audits)
        for private in ("Private objective", "Private outcome", "Private note", "Private evidence"):
            assert private not in serialized
