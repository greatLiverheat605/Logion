from unittest.mock import Mock

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings
from logion_api.main import create_app
from logion_api.users.dependencies import get_user_setting_service
from logion_api.workbenches.contract_routes import router as contract_router
from logion_api.workbenches.routes import delete_router, router
from logion_api.workbenches.service import WorkbenchUserSettingService
from pydantic import SecretStr, ValidationError

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
        f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/"
        "00000000-0000-0000-0000-000000000002",
    ),
    (
        "DELETE",
        f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/"
        "00000000-0000-0000-0000-000000000002",
    ),
    ("POST", f"{BASE_PATH}/00000000-0000-0000-0000-000000000001/links/reorder"),
]


def _enabled_settings(*, delete_enabled: bool = False) -> Settings:
    return Settings(
        workbench_custom_api_enabled=True,
        workbench_delete_api_enabled=delete_enabled,
        workbench_impact_active_key_id="active",
        workbench_impact_keys={"active": SecretStr("a" * 32)},
    )


def test_workbench_flags_default_off_and_enabled_api_requires_impact_key() -> None:
    settings = Settings()
    assert settings.workbench_custom_api_enabled is False
    assert settings.workbench_delete_api_enabled is False

    with pytest.raises(ValidationError, match="WORKBENCH_IMPACT_ACTIVE_KEY_ID"):
        Settings(workbench_custom_api_enabled=True)
    with pytest.raises(ValidationError, match="requires the main Workbench API flag"):
        Settings(workbench_delete_api_enabled=True)


@pytest.mark.asyncio
async def test_flag_off_is_byte_equivalent_to_unknown_path_with_zero_route_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("logion_api.main.get_settings", Settings)
    application = create_app()
    dependency_spy = Mock(side_effect=AssertionError("disabled Workbench dependency executed"))
    application.dependency_overrides[get_user_setting_service] = dependency_spy

    included = [getattr(route_, "original_router", None) for route_ in application.routes]
    assert router not in included
    assert delete_router not in included

    async with AsyncClient(
        transport=ASGITransport(app=application),
        base_url="http://test",
    ) as client:
        unknown = await client.post("/api/v1/not-a-route", content=b"{not-json")
        for method, path in WORKBENCH_REQUESTS:
            response = await client.request(
                method,
                path,
                headers={"Origin": "https://untrusted.test", "X-CSRF-Token": "bad"},
                content=b"{not-json",
            )
            assert response.status_code == unknown.status_code == 404
            assert response.content == unknown.content
            assert response.headers["content-type"] == unknown.headers["content-type"]

    dependency_spy.assert_not_called()


def test_enabled_app_registers_13_routes_until_delete_proxy_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _enabled_settings()
    monkeypatch.setattr("logion_api.main.get_settings", lambda: settings)
    application = create_app()
    included = [getattr(route_, "original_router", None) for route_ in application.routes]
    assert router in included
    assert delete_router not in included
    assert len(router.routes) == 13
    assert all(
        "DELETE" not in (route_.methods or set())
        for route_ in router.routes
        if isinstance(route_, APIRoute)
    )
    override = application.dependency_overrides[get_user_setting_service]
    assert isinstance(override(), WorkbenchUserSettingService)


def test_delete_proxy_gate_registers_only_the_two_approved_delete_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _enabled_settings(delete_enabled=True)
    monkeypatch.setattr("logion_api.main.get_settings", lambda: settings)
    application = create_app()
    included = [getattr(route_, "original_router", None) for route_ in application.routes]
    assert router in included
    assert delete_router in included
    assert len(delete_router.routes) == 2


def test_dormant_contract_mode_never_establishes_enabled_data_routes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _enabled_settings(delete_enabled=True)
    monkeypatch.setattr("logion_api.main.get_settings", lambda: settings)
    application = create_app(include_dormant_contracts=True)
    included = [getattr(route_, "original_router", None) for route_ in application.routes]

    assert contract_router in included
    assert router not in included
    assert delete_router not in included
    assert get_user_setting_service not in application.dependency_overrides
