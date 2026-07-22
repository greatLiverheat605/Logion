from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.adapter import DiscoveredModel
from logion_api.ai_gateway.crypto import AIProviderCredentialCipher
from logion_api.ai_gateway.dependencies import get_ai_discovery_adapter
from logion_api.ai_gateway.models import AIModel, AIProvider
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


class FakeDiscoveryAdapter:
    credentials: list[str] = []

    async def discover(
        self, *, base_url: str, credential: str, timeout_seconds: int
    ) -> list[DiscoveredModel]:
        assert base_url == "https://api.example.com/v1"
        assert timeout_seconds == 30
        self.credentials.append(credential)
        return [
            DiscoveredModel(provider_model_id="model-a", display_name="model-a"),
            DiscoveredModel(provider_model_id="model-b", display_name="model-b"),
        ]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_provider_credentials_are_server_only_and_workspace_scoped() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.160", 49000)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.161", 49001)),
            base_url=origin,
            headers={"Origin": origin},
        ) as viewer,
    ):
        registrations = []
        for client, label in ((owner, "owner"), (viewer, "viewer")):
            registrations.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"provider-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        viewer_id = UUID(registrations[1].json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        viewer_workspace = UUID(
            (await viewer.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
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

        base = f"/api/v1/workspaces/{workspace_id}/ai/providers"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        first_secret = f"test-provider-{uuid4().hex}"
        provider_id = uuid4()
        payload = {
            "id": str(provider_id),
            "name": "Primary Provider",
            "provider_type": "openai_compatible",
            "base_url": "https://api.example.com/openai/v1/",
            "credential": first_secret,
            "enabled": True,
            "timeout_seconds": 45,
            "max_retries": 2,
        }
        assert (await owner.post(base, json=payload)).status_code == 403
        blocked = await owner.post(
            base,
            headers=csrf,
            json={**payload, "id": str(uuid4()), "base_url": "https://127.0.0.1/v1"},
        )
        assert blocked.status_code == 422
        created = await owner.post(base, headers=csrf, json=payload)
        assert created.status_code == 201, created.text
        assert created.json()["base_url"] == "https://api.example.com/openai/v1"
        assert created.json()["credential_configured"] is True
        assert first_secret not in created.text
        assert all(
            key not in created.json()
            for key in (
                "credential",
                "credential_ciphertext",
                "data_key_ciphertext",
                "credential_nonce",
            )
        )

        assert (await viewer.get(base)).status_code == 403
        assert (
            await owner.get(f"/api/v1/workspaces/{viewer_workspace}/ai/providers")
        ).status_code == 404
        duplicate = await owner.post(
            base,
            headers=csrf,
            json={**payload, "id": str(uuid4()), "name": "primary provider"},
        )
        assert duplicate.status_code == 409

        async with session_factory() as db:
            provider = await db.get(AIProvider, provider_id)
            assert provider is not None
            assert first_secret.encode() not in provider.credential_ciphertext
            assert AIProviderCredentialCipher(get_settings()).decrypt(provider) == first_secret

        update = {
            "expected_version": 1,
            "name": "Primary Provider",
            "base_url": "https://api.example.com/v1",
            "credential": None,
            "enabled": False,
            "timeout_seconds": 20,
            "max_retries": 1,
        }
        updated = await owner.put(f"{base}/{provider_id}", headers=csrf, json=update)
        assert updated.status_code == 200, updated.text
        assert updated.json()["version"] == 2
        async with session_factory() as db:
            provider = await db.get(AIProvider, provider_id)
            assert provider is not None
            assert AIProviderCredentialCipher(get_settings()).decrypt(provider) == first_secret

        rotated_secret = f"rotated-provider-{uuid4().hex}"
        rotated = await owner.put(
            f"{base}/{provider_id}",
            headers=csrf,
            json={**update, "expected_version": 2, "credential": rotated_secret},
        )
        assert rotated.status_code == 200, rotated.text
        assert rotated_secret not in rotated.text
        stale = await owner.request(
            "DELETE",
            f"{base}/{provider_id}",
            headers=csrf,
            json={"expected_version": 2},
        )
        assert stale.status_code == 409
        deleted = await owner.request(
            "DELETE",
            f"{base}/{provider_id}",
            headers=csrf,
            json={"expected_version": 3},
        )
        assert deleted.status_code == 204, deleted.text
        assert (await owner.get(base)).json()["providers"] == []

    async with session_factory() as db:
        provider = await db.get(AIProvider, provider_id)
        assert provider is not None and provider.deleted_at is not None
        assert provider.credential_ciphertext is None
        audit_rows = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        audit_text = " ".join(str(row.event_metadata) for row in audit_rows)
        assert any(row.event_type == "authorization.permission_denied" for row in audit_rows)
        assert first_secret not in audit_text
        assert rotated_secret not in audit_text
        assert "api.example.com" not in audit_text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_model_discovery_is_authorized_audited_and_idempotent() -> None:
    origin = "http://test"
    fake = FakeDiscoveryAdapter()
    FakeDiscoveryAdapter.credentials = []
    app.dependency_overrides[get_ai_discovery_adapter] = lambda: fake
    try:
        async with (
            AsyncClient(
                transport=ASGITransport(app=app, client=("192.0.2.162", 49002)),
                base_url=origin,
                headers={"Origin": origin},
            ) as owner,
            AsyncClient(
                transport=ASGITransport(app=app, client=("192.0.2.163", 49003)),
                base_url=origin,
                headers={"Origin": origin},
            ) as viewer,
        ):
            owner_registration = await owner.post(
                "/api/v1/auth/register",
                json={
                    "email": f"discovery-owner-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "owner",
                },
            )
            viewer_registration = await viewer.post(
                "/api/v1/auth/register",
                json={
                    "email": f"discovery-viewer-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "viewer",
                },
            )
            assert owner_registration.status_code == 201
            assert viewer_registration.status_code == 201
            viewer_id = UUID(viewer_registration.json()["user"]["id"])
            workspace_id = UUID(
                (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            )
            external_workspace_id = UUID(
                (await viewer.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            )
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

            provider_id = uuid4()
            secret = f"discovery-secret-{uuid4().hex}"
            base = f"/api/v1/workspaces/{workspace_id}/ai/providers"
            csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
            created = await owner.post(
                base,
                headers=csrf,
                json={
                    "id": str(provider_id),
                    "name": "Discovery Provider",
                    "provider_type": "openai_compatible",
                    "base_url": "https://api.example.com/v1",
                    "credential": secret,
                    "enabled": True,
                    "timeout_seconds": 30,
                    "max_retries": 0,
                },
            )
            assert created.status_code == 201, created.text
            discover_url = f"{base}/{provider_id}/discover-models"
            assert (await owner.post(discover_url)).status_code == 403
            assert (
                await viewer.post(
                    discover_url, headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]}
                )
            ).status_code == 403
            assert (
                await owner.post(
                    f"/api/v1/workspaces/{external_workspace_id}/ai/providers/{provider_id}/discover-models",
                    headers=csrf,
                )
            ).status_code == 404

            first = await owner.post(discover_url, headers=csrf)
            second = await owner.post(discover_url, headers=csrf)
            assert first.status_code == 200, first.text
            assert second.status_code == 200, second.text
            assert first.json()["model_count"] == 2
            models = await owner.get(f"/api/v1/workspaces/{workspace_id}/ai/models")
            assert models.status_code == 200
            assert {row["provider_model_id"] for row in models.json()["models"]} == {
                "model-a",
                "model-b",
            }
            assert len(FakeDiscoveryAdapter.credentials) == 2
            assert all(value == secret for value in FakeDiscoveryAdapter.credentials)

        async with session_factory() as db:
            provider = await db.get(AIProvider, provider_id)
            assert provider is not None
            assert provider.last_health_status == "healthy"
            assert provider.last_health_error_code is None
            rows = list(
                (
                    await db.scalars(
                        select(AIModel).where(
                            AIModel.workspace_id == workspace_id,
                            AIModel.provider_id == provider_id,
                        )
                    )
                ).all()
            )
            assert len(rows) == 2
            audits = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(
                            AuditEvent.workspace_id == workspace_id,
                            AuditEvent.event_type == "ai.provider_models_discovered",
                        )
                    )
                ).all()
            )
            assert len(audits) == 2
            audit_text = " ".join(str(row.event_metadata) for row in audits)
            assert secret not in audit_text
            assert "api.example.com" not in audit_text
    finally:
        app.dependency_overrides.pop(get_ai_discovery_adapter, None)
