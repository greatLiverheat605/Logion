import ast
import inspect
import socket
from typing import cast

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from logion_api.main import create_app
from logion_api.workbenches import contract_routes

BASE_PATH = "/api/v1/users/me/workbenches"
WORKBENCH_REQUESTS = [
    ("GET", BASE_PATH),
    ("POST", BASE_PATH),
    ("POST", f"{BASE_PATH}/imports"),
    ("GET", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001"),
    ("PUT", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001"),
    ("POST", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/archive"),
    ("POST", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/restore"),
    ("GET", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/deletion-impact"),
    ("DELETE", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001"),
    ("GET", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/export"),
    ("GET", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links"),
    ("POST", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links"),
    (
        "PATCH",
        f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/00000000-0000-0000-0000-000000000002",
    ),
    (
        "DELETE",
        f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/00000000-0000-0000-0000-000000000002",
    ),
    ("POST", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/reorder"),
]


def test_dormant_router_has_no_runtime_dependencies_or_side_effect_imports() -> None:
    assert len(contract_routes.router.routes) == 15
    routes = [cast(APIRoute, route) for route in contract_routes.router.routes]
    assert all(route.dependant.dependencies == [] for route in routes)

    tree = ast.parse(inspect.getsource(contract_routes))
    imported_roots = {
        alias.name.split(".", 1)[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module.split(".", 1)[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module is not None
    }
    assert imported_roots.isdisjoint(
        {
            "httpx",
            "importlib",
            "requests",
            "socket",
            "sqlalchemy",
            "subprocess",
        }
    )
    source = inspect.getsource(contract_routes)
    for forbidden in (
        "get_db",
        "get_session",
        "rate_limiter",
        "repository",
        "workspace_service",
        "mutation_service",
    ):
        assert forbidden not in source


@pytest.mark.asyncio
async def test_default_app_has_no_workbench_route_side_effects() -> None:
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for method, path in WORKBENCH_REQUESTS:
            response = await client.request(method, path, json={"malformed": True})
            assert response.status_code == 404
            assert response.json() == {"detail": "Not Found"}


@pytest.mark.asyncio
async def test_dormant_routes_return_unknown_path_404_before_validation() -> None:
    app = create_app(include_dormant_contracts=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        unknown = await client.post("/api/v1/users/me/workbenches-not-real", json={"bad": True})
        for method, path in WORKBENCH_REQUESTS:
            response = await client.request(
                method,
                path,
                headers={"Origin": "not-a-trusted-origin", "X-CSRF-Token": "bad"},
                content=b"{not-json",
            )
            assert response.status_code == unknown.status_code == 404
            assert response.json() == unknown.json() == {"detail": "Not Found"}
            assert response.headers["content-type"] == unknown.headers["content-type"]


@pytest.mark.asyncio
async def test_dormant_requests_do_not_open_network_sockets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = create_app(include_dormant_contracts=True)

    def reject_socket(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("dormant Workbench route attempted network access")

    monkeypatch.setattr(socket, "socket", reject_socket)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for method, path in WORKBENCH_REQUESTS:
            response = await client.request(method, path, content=b"{not-json")
            assert response.status_code == 404


@pytest.mark.asyncio
async def test_invalid_uuid_and_static_paths_fail_closed_before_body_validation() -> None:
    app = create_app(include_dormant_contracts=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        for path in (
            f"{BASE_PATH}/not-a-uuid",
            f"{BASE_PATH}/fixed.learning",
            f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/unknown-static",
        ):
            response = await client.request("GET", path, content=b"not-json")
            assert response.status_code == 404
            assert response.json() == {"detail": "Not Found"}
