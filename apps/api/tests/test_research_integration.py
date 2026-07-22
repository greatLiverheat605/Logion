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

TYPES = (
    "paper_record",
    "research_claim",
    "research_question",
    "experiment_run",
    "metric_record",
    "research_feedback",
)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_research_evidence_loop_is_personal_and_offline() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.130", 48700)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.131", 48701)),
            base_url=origin,
            headers={"Origin": origin},
        ) as learner,
    ):

        async def register(client: AsyncClient, label: str):
            return await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"research-{label}-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": label,
                },
            )

        a, b = await register(owner, "owner"), await register(learner, "learner")
        assert a.status_code == b.status_code == 201
        learner_id = UUID(b.json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        shared = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={"name": "Configurable research space", "visibility": "shared"},
        )
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
        base = f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/research"
        ids = {kind: uuid4() for kind in TYPES}
        now = datetime.now(UTC).isoformat()
        payloads = {
            "paper_record": {
                "id": str(ids["paper_record"]),
                "title": "Private paper",
                "citation_key": "private-citation",
                "source_url": None,
            },
            "research_claim": {
                "id": str(ids["research_claim"]),
                "paper_id": str(ids["paper_record"]),
                "statement": "Private claim",
                "stance": "supports",
            },
            "research_question": {
                "id": str(ids["research_question"]),
                "question": "Private question?",
                "rationale": "Private rationale",
            },
            "experiment_run": {
                "id": str(ids["experiment_run"]),
                "question_id": str(ids["research_question"]),
                "title": "Private run",
                "method_summary": "Private method",
                "completed_at": now,
            },
            "metric_record": {
                "id": str(ids["metric_record"]),
                "run_id": str(ids["experiment_run"]),
                "name": "Private metric",
                "value": 0.9,
                "unit": "score",
            },
            "research_feedback": {
                "id": str(ids["research_feedback"]),
                "claim_id": str(ids["research_claim"]),
                "description": "Private feedback",
                "requested_action": "Private action",
            },
        }
        paths = {
            "paper_record": "papers",
            "research_claim": "claims",
            "research_question": "questions",
            "experiment_run": "runs",
            "metric_record": "metrics",
            "research_feedback": "feedback",
        }
        assert (
            await owner.post(f"{base}/papers", json=payloads["paper_record"])
        ).status_code == 403
        for kind in TYPES:
            result = await owner.post(
                f"{base}/{paths[kind]}",
                headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
                json=payloads[kind],
            )
            assert result.status_code == 201, result.text
        assert len((await owner.get(base)).json()["papers"]) == 1
        assert all(not values for values in (await learner.get(base)).json().values())

        async def device(client: AsyncClient) -> UUID:
            rows = (await client.get("/api/v1/auth/devices")).json()["devices"]
            return UUID(next(x["id"] for x in rows if x["current"]))

        owner_device, learner_device = await device(owner), await device(learner)

        def boot(device_id: UUID):
            return {
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            }

        owner_boot = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=boot(owner_device)
        )
        learner_boot = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/bootstrap", json=boot(learner_device)
        )
        assert set(TYPES).issubset({x["entity_type"] for x in owner_boot.json()["records"]})
        assert set(TYPES).isdisjoint({x["entity_type"] for x in learner_boot.json()["records"]})
        offline_ids = {kind: uuid4() for kind in TYPES}
        ops = {kind: uuid4() for kind in TYPES}
        raw = {
            "paper_record": {
                "space_id": str(space_id),
                "title": "Offline paper",
                "citation_key": "offline-key",
                "source_url": None,
            },
            "research_claim": {
                "space_id": str(space_id),
                "paper_id": str(offline_ids["paper_record"]),
                "statement": "Offline claim",
                "stance": "mixed",
            },
            "research_question": {
                "space_id": str(space_id),
                "question": "Offline question?",
                "rationale": "Offline rationale",
            },
            "experiment_run": {
                "space_id": str(space_id),
                "question_id": str(offline_ids["research_question"]),
                "title": "Offline run",
                "method_summary": "Offline method",
                "completed_at": now,
            },
            "metric_record": {
                "space_id": str(space_id),
                "run_id": str(offline_ids["experiment_run"]),
                "name": "Offline metric",
                "value": 1.2,
                "unit": "value",
            },
            "research_feedback": {
                "space_id": str(space_id),
                "claim_id": str(offline_ids["research_claim"]),
                "description": "Offline feedback",
                "requested_action": "Offline action",
            },
        }
        deps = {
            "paper_record": [],
            "research_question": [],
            "research_claim": [ops["paper_record"]],
            "experiment_run": [ops["research_question"]],
            "metric_record": [ops["experiment_run"]],
            "research_feedback": [ops["research_claim"]],
        }
        operations = [
            {
                "operation_id": str(ops[k]),
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(learner_device),
                "entity_type": k,
                "entity_id": str(offline_ids[k]),
                "operation_type": "create",
                "base_version": 0,
                "client_occurred_at": now,
                "payload": raw[k],
                "payload_hash": canonical_hash(raw[k]),
                "dependencies": [str(x) for x in deps[k]],
            }
            for k in TYPES
        ]
        pushed = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/push",
            headers={"X-CSRF-Token": learner.cookies["logion_csrf"]},
            json={
                "message_type": "push_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(learner_device),
                "sync_epoch": learner_boot.json()["sync_epoch"],
                "operations": operations,
            },
        )
        assert pushed.status_code == 200, pushed.text
        assert all(x["status"] == "applied" for x in pushed.json()["results"])

        def pull(device_id: UUID):
            return {
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": str(workspace_id),
                "device_id": str(device_id),
                "sync_epoch": learner_boot.json()["sync_epoch"],
                "cursor": 0,
                "limit": 100,
            }

        lp = await learner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull", json=pull(learner_device)
        )
        op = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/sync/pull", json=pull(owner_device)
        )
        private_ids = {str(x) for x in offline_ids.values()}
        assert private_ids.issubset({x["entity_id"] for x in lp.json()["changes"]})
        assert private_ids.isdisjoint({x["entity_id"] for x in op.json()["changes"]})
        assert op.json()["next_cursor"] >= pushed.json()["results"][-1]["sequence"]
    async with session_factory() as db:
        text = " ".join(
            str(x.event_metadata)
            for x in (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        for secret in ("Private claim", "Private method", "Private feedback"):
            assert secret not in text
