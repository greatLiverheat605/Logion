from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.adapter import DiscoveredModel
from logion_api.ai_gateway.dependencies import get_ai_discovery_adapter
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership


class RoutingDiscoveryAdapter:
    async def discover(
        self, *, base_url: str, credential: str, timeout_seconds: int
    ) -> list[DiscoveredModel]:
        assert base_url == "https://api.example.com/v1"
        assert credential.startswith("routing-secret-")
        assert timeout_seconds == 30
        return [
            DiscoveredModel(provider_model_id="route-primary", display_name="Primary"),
            DiscoveredModel(provider_model_id="route-fallback", display_name="Fallback"),
        ]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_ai_routes_enforce_budget_order_capability_and_tenant_boundaries() -> None:
    origin = "http://test"
    app.dependency_overrides[get_ai_discovery_adapter] = lambda: RoutingDiscoveryAdapter()
    try:
        async with (
            AsyncClient(
                transport=ASGITransport(app=app, client=("192.0.2.164", 49004)),
                base_url=origin,
                headers={"Origin": origin},
            ) as owner,
            AsyncClient(
                transport=ASGITransport(app=app, client=("192.0.2.165", 49005)),
                base_url=origin,
                headers={"Origin": origin},
            ) as viewer,
        ):
            owner_registration = await owner.post(
                "/api/v1/auth/register",
                json={
                    "email": f"routing-owner-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "owner",
                },
            )
            viewer_registration = await viewer.post(
                "/api/v1/auth/register",
                json={
                    "email": f"routing-viewer-{uuid4()}@example.com",
                    "password": "a-strong-password-123",
                    "device_name": "viewer",
                },
            )
            assert owner_registration.status_code == 201
            assert viewer_registration.status_code == 201
            workspace_id = UUID(
                (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            )
            external_workspace_id = UUID(
                (await viewer.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            )
            viewer_id = UUID(viewer_registration.json()["user"]["id"])
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

            csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
            provider_id = uuid4()
            providers_url = f"/api/v1/workspaces/{workspace_id}/ai/providers"
            provider = await owner.post(
                providers_url,
                headers=csrf,
                json={
                    "id": str(provider_id),
                    "name": "Routing Provider",
                    "provider_type": "openai_compatible",
                    "base_url": "https://api.example.com/v1",
                    "credential": f"routing-secret-{uuid4().hex}",
                    "enabled": True,
                    "timeout_seconds": 30,
                    "max_retries": 0,
                },
            )
            assert provider.status_code == 201, provider.text
            discovered = await owner.post(
                f"{providers_url}/{provider_id}/discover-models", headers=csrf
            )
            assert discovered.status_code == 200, discovered.text
            models = discovered.json()["models"]
            assert len(models) == 2
            model_ids = [row["id"] for row in models]
            for row in models:
                updated = await owner.put(
                    f"/api/v1/workspaces/{workspace_id}/ai/models/{row['id']}",
                    headers=csrf,
                    json={
                        "expected_version": row["version"],
                        "display_name": row["display_name"],
                        "enabled": True,
                        "supports_json": True,
                        "supports_stream": True,
                        "context_window": 8192,
                        "pricing_currency": "USD",
                        "input_cost_per_million_minor": 200,
                        "output_cost_per_million_minor": 300,
                    },
                )
                assert updated.status_code == 200, updated.text

            budget_url = f"/api/v1/workspaces/{workspace_id}/ai/budget"
            assert (await owner.put(budget_url, json={})).status_code == 403
            budget = await owner.put(
                budget_url,
                headers=csrf,
                json={
                    "expected_version": None,
                    "monthly_token_budget": 10000,
                    "monthly_cost_budget_minor": 100,
                    "currency": "USD",
                },
            )
            assert budget.status_code == 200, budget.text
            assert budget.json()["version"] == 1
            assert (
                await viewer.get(f"/api/v1/workspaces/{workspace_id}/ai/budget")
            ).status_code == 403
            assert (
                await owner.get(f"/api/v1/workspaces/{external_workspace_id}/ai/routes")
            ).status_code == 404

            route_id = uuid4()
            routes_url = f"/api/v1/workspaces/{workspace_id}/ai/routes"
            route_payload = {
                "id": str(route_id),
                "name": "Structured assistant",
                "task_type": "user.structured-draft",
                "requires_json": True,
                "requires_stream": False,
                "max_input_tokens": 4000,
                "max_output_tokens": 2000,
                "enabled": True,
                "model_ids": model_ids,
            }
            route = await owner.post(routes_url, headers=csrf, json=route_payload)
            assert route.status_code == 201, route.text
            duplicate = await owner.post(
                routes_url,
                headers=csrf,
                json={**route_payload, "id": str(uuid4()), "name": "Duplicate"},
            )
            assert duplicate.status_code == 409

            preview_url = f"/api/v1/workspaces/{workspace_id}/ai/route-resolution-preview"
            preview_payload = {
                "task_type": "user.structured-draft",
                "estimated_input_tokens": 1000,
                "requested_output_tokens": 500,
            }
            preview = await owner.post(preview_url, headers=csrf, json=preview_payload)
            assert preview.status_code == 200, preview.text
            assert [row["selection"] for row in preview.json()["candidates"]] == [
                "primary",
                "fallback",
            ]
            assert all(row["estimated_cost_minor"] == 1 for row in preview.json()["candidates"])

            disabled = await owner.put(
                f"/api/v1/workspaces/{workspace_id}/ai/models/{model_ids[0]}",
                headers=csrf,
                json={
                    "expected_version": 2,
                    "display_name": "Primary",
                    "enabled": False,
                    "supports_json": True,
                    "supports_stream": True,
                    "context_window": 8192,
                    "pricing_currency": "USD",
                    "input_cost_per_million_minor": 200,
                    "output_cost_per_million_minor": 300,
                },
            )
            assert disabled.status_code == 200, disabled.text
            fallback = await owner.post(preview_url, headers=csrf, json=preview_payload)
            assert fallback.status_code == 200, fallback.text
            assert len(fallback.json()["candidates"]) == 1
            assert fallback.json()["candidates"][0]["selection"] == "fallback"

            reduced_budget = await owner.put(
                budget_url,
                headers=csrf,
                json={
                    "expected_version": 1,
                    "monthly_token_budget": 1000,
                    "monthly_cost_budget_minor": 100,
                    "currency": "USD",
                },
            )
            assert reduced_budget.status_code == 200, reduced_budget.text
            budget_blocked = await owner.post(preview_url, headers=csrf, json=preview_payload)
            assert budget_blocked.status_code == 409
            assert budget_blocked.json()["code"] == "AI_BUDGET_EXCEEDED"

            over_budget = await owner.post(
                preview_url,
                headers=csrf,
                json={**preview_payload, "estimated_input_tokens": 20000},
            )
            assert over_budget.status_code == 422
    finally:
        app.dependency_overrides.pop(get_ai_discovery_adapter, None)
