from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent, AuthSession
from logion_api.knowledge_space.models import (
    LocalWorkerCheckpoint,
    LocalWorkerLease,
    LocalWorkerResultReceipt,
)
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select, update

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

ORIGIN = "http://test"


def _client_address(port: int) -> tuple[str, int]:
    return f"192.0.2.{uuid4().int % 200 + 20}", port


async def _register(client: AsyncClient, label: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"local-worker-{label}-{uuid4()}@example.com",
            "password": "a-strong-password-123",
            "device_name": label,
        },
    )
    assert response.status_code == 201, response.text
    user = (await client.get("/api/v1/auth/me")).json()
    workspaces = (await client.get("/api/v1/workspaces")).json()["workspaces"]
    workspace_id = workspaces[0]["id"]
    spaces = (await client.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"]
    return {
        "user_id": user["id"],
        "workspace_id": workspace_id,
        "space_id": spaces[0]["id"],
        "csrf": client.cookies["logion_csrf"],
    }


@pytest.mark.integration
async def test_local_worker_feature_is_closed_before_auth_and_validation() -> None:
    original_overrides = dict(app.dependency_overrides)
    app.dependency_overrides.pop(get_settings, None)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as client:
            response = await client.post("/api/v1/local-worker/leases", json={})
        assert response.status_code == 404
        assert response.json()["code"] == "KNOWLEDGE_LOCAL_WORKER_DISABLED"
        assert response.headers["cache-control"] == "private, no-store"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def test_local_worker_authenticated_protocol_is_tenant_bound_and_idempotent() -> None:
    base_settings = get_settings()
    original_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "knowledge_space_api_enabled": True,
            "knowledge_space_local_worker_enabled": True,
        }
    )
    try:
        async with (
            AsyncClient(
                transport=ASGITransport(app=app, client=_client_address(49101)),
                base_url=ORIGIN,
                headers={"Origin": ORIGIN},
            ) as owner,
            AsyncClient(
                transport=ASGITransport(app=app, client=_client_address(49102)),
                base_url=ORIGIN,
                headers={"Origin": ORIGIN},
            ) as outsider,
        ):
            owner_scope = await _register(owner, "owner")
            outsider_scope = await _register(outsider, "outsider")
            async with session_factory() as db:
                db.add(
                    WorkspaceMembership(
                        workspace_id=UUID(owner_scope["workspace_id"]),
                        user_id=UUID(outsider_scope["user_id"]),
                        role="viewer",
                        status="active",
                    )
                )
                await db.commit()

            csrf = {"X-CSRF-Token": owner_scope["csrf"]}
            lease_url = "/api/v1/local-worker/leases"
            job_id = uuid4()
            input_sha256 = "a" * 64
            lease_payload = {
                "job_id": str(job_id),
                "workspace_id": owner_scope["workspace_id"],
                "space_id": owner_scope["space_id"],
                "input_sha256": input_sha256,
            }

            missing_csrf = await owner.post(lease_url, json=lease_payload)
            assert missing_csrf.status_code == 403
            assert missing_csrf.headers["cache-control"] == "private, no-store"
            invalid_origin = await owner.post(
                lease_url,
                headers={**csrf, "Origin": "http://evil"},
                json=lease_payload,
            )
            assert invalid_origin.status_code == 403

            issued = await owner.post(lease_url, headers=csrf, json=lease_payload)
            assert issued.status_code == 201, issued.text
            issued_payload = issued.json()
            token = issued_payload["token"]
            assert issued.headers["cache-control"] == "private, no-store"
            lease_id = issued_payload["lease_id"]

            checkpoint_url = f"/api/v1/local-worker/jobs/{job_id}/checkpoints"
            wrong_token = await owner.post(
                checkpoint_url,
                headers={"Authorization": "Bearer wrong-token"},
                json={
                    "lease_id": lease_id,
                    "workspace_id": owner_scope["workspace_id"],
                    "space_id": owner_scope["space_id"],
                    "input_sha256": input_sha256,
                    "stage": "claimed",
                },
            )
            assert wrong_token.status_code == 401
            assert wrong_token.headers["cache-control"] == "private, no-store"

            worker_headers = {"Authorization": f"Bearer {token}"}
            for stage in ("claimed", "running"):
                checkpoint = await owner.post(
                    checkpoint_url,
                    headers=worker_headers,
                    json={
                        "lease_id": lease_id,
                        "workspace_id": owner_scope["workspace_id"],
                        "space_id": owner_scope["space_id"],
                        "input_sha256": input_sha256,
                        "stage": stage,
                    },
                )
                assert checkpoint.status_code == 200, checkpoint.text
                assert checkpoint.json()["stage"] == stage

            regression = await owner.post(
                checkpoint_url,
                headers=worker_headers,
                json={
                    "lease_id": lease_id,
                    "workspace_id": owner_scope["workspace_id"],
                    "space_id": owner_scope["space_id"],
                    "input_sha256": input_sha256,
                    "stage": "claimed",
                },
            )
            assert regression.status_code == 409
            assert regression.json()["code"] == "KNOWLEDGE_LOCAL_WORKER_STATE_CONFLICT"

            output_sha256 = "b" * 64
            uploaded = await owner.post(
                checkpoint_url,
                headers=worker_headers,
                json={
                    "lease_id": lease_id,
                    "workspace_id": owner_scope["workspace_id"],
                    "space_id": owner_scope["space_id"],
                    "input_sha256": input_sha256,
                    "stage": "uploaded",
                    "output_sha256": output_sha256,
                },
            )
            assert uploaded.status_code == 200, uploaded.text

            recovery_url = f"/api/v1/local-worker/jobs/{job_id}/recovery"
            recovered = await owner.get(recovery_url)
            assert recovered.status_code == 200
            assert recovered.json()["checkpoint"]["stage"] == "uploaded"
            outsider_recovery = await outsider.get(recovery_url)
            assert outsider_recovery.status_code == 404
            assert outsider_recovery.json()["code"] == "RESOURCE_NOT_FOUND"

            result_url = f"/api/v1/local-worker/jobs/{job_id}/result"
            result_payload = {
                "lease_id": lease_id,
                "workspace_id": owner_scope["workspace_id"],
                "space_id": owner_scope["space_id"],
                "input_sha256": input_sha256,
                "idempotency_key": "result-1",
                "output_sha256": output_sha256,
            }
            accepted = await owner.post(result_url, headers=worker_headers, json=result_payload)
            assert accepted.status_code == 200, accepted.text
            assert accepted.json()["replayed"] is False
            replay = await owner.post(result_url, headers=worker_headers, json=result_payload)
            assert replay.status_code == 200, replay.text
            assert replay.json()["replayed"] is True
            conflict = await owner.post(
                result_url,
                headers=worker_headers,
                json={**result_payload, "output_sha256": "c" * 64},
            )
            assert conflict.status_code == 409
            assert conflict.json()["code"] == "KNOWLEDGE_LOCAL_WORKER_IDEMPOTENCY_CONFLICT"
            completed = await owner.get(recovery_url)
            assert completed.json() == {
                "job_id": str(job_id),
                "state": "completed",
                "checkpoint": None,
            }

            revoked_job = uuid4()
            revoked = await owner.post(
                lease_url,
                headers=csrf,
                json={**lease_payload, "job_id": str(revoked_job)},
            )
            assert revoked.status_code == 201
            revoked_lease_id = revoked.json()["lease_id"]
            revoked_response = await owner.post(
                f"/api/v1/local-worker/leases/{revoked_lease_id}/revoke",
                headers=csrf,
            )
            assert revoked_response.status_code == 200
            rejected = await owner.post(
                f"/api/v1/local-worker/jobs/{revoked_job}/checkpoints",
                headers={"Authorization": f"Bearer {revoked.json()['token']}"},
                json={
                    "lease_id": revoked_lease_id,
                    "workspace_id": owner_scope["workspace_id"],
                    "space_id": owner_scope["space_id"],
                    "input_sha256": input_sha256,
                    "stage": "claimed",
                },
            )
            assert rejected.status_code == 401

        async with session_factory() as db:
            lease = await db.get(LocalWorkerLease, UUID(lease_id))
            receipt = await db.scalar(
                select(LocalWorkerResultReceipt).where(
                    LocalWorkerResultReceipt.job_id == job_id,
                )
            )
            assert lease is not None and lease.token_sha256 != token
            assert receipt is not None and receipt.output_sha256 == output_sha256
            assert (
                await db.scalar(
                    select(LocalWorkerCheckpoint.id).where(LocalWorkerCheckpoint.job_id == job_id)
                )
                is None
            )
            audits = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(AuditEvent.target_id.in_([job_id, revoked_job]))
                    )
                ).all()
            )
            assert token not in " ".join(str(row.event_metadata) for row in audits)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def test_local_worker_requires_recent_reauthentication() -> None:
    base_settings = get_settings()
    original_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_settings] = lambda: base_settings.model_copy(
        update={
            "knowledge_space_api_enabled": True,
            "knowledge_space_local_worker_enabled": True,
        }
    )
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, client=_client_address(49103)),
            base_url=ORIGIN,
            headers={"Origin": ORIGIN},
        ) as owner:
            scope = await _register(owner, "recent-auth")
            async with session_factory() as db:
                await db.execute(
                    update(AuthSession)
                    .where(AuthSession.user_id == UUID(scope["user_id"]))
                    .values(created_at=datetime.now(UTC) - timedelta(hours=2))
                )
                await db.commit()
            response = await owner.post(
                "/api/v1/local-worker/leases",
                headers={"X-CSRF-Token": scope["csrf"]},
                json={
                    "job_id": str(uuid4()),
                    "workspace_id": scope["workspace_id"],
                    "space_id": scope["space_id"],
                    "input_sha256": "a" * 64,
                },
            )
            assert response.status_code == 403
            assert response.json()["code"] == "AUTH_RECENT_LOGIN_REQUIRED"
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)
