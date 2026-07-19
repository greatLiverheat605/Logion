import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.main import app


@pytest.mark.asyncio
async def test_liveness_has_request_id() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "api",
        "version": "0.1.0",
        "checks": None,
    }
    assert response.headers["x-request-id"]


@pytest.mark.asyncio
async def test_readiness() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(
            "/health/ready",
            headers={"x-request-id": "phase-0-check"},
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert response.json()["checks"] == {"application": "ok"}
    assert response.headers["x-request-id"] == "phase-0-check"


@pytest.mark.asyncio
async def test_invalid_request_id_is_not_reflected() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health/live", headers={"x-request-id": "invalid value"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] != "invalid value"
