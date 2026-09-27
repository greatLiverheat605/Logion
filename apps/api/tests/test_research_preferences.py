import json
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings, get_settings
from logion_api.errors import APIError
from logion_api.main import app
from logion_api.users.research_preferences import validate_research_preference


def test_research_preferences_are_default_off_and_strictly_typed() -> None:
    assert Settings(_env_file=None).research_v3_enabled is False
    for key, value in [
        ("appearance.theme", '"sepia"'),
        ("reader.selection_menu", '"true"'),
        ("workbench.context", '{"workspace_id":"bad","space_id":"bad"}'),
        (
            "workbench.layouts",
            json.dumps(
                {
                    "preset": "focus",
                    "toolbars": False,
                    "panes": [{"content": "info", "width": 30, "collapsed": True}] * 3,
                }
            ),
        ),
    ]:
        with pytest.raises(APIError) as raised:
            validate_research_preference(key, value)
        assert raised.value.code == "RESEARCH_PREFERENCE_INVALID"
        assert raised.value.details == {"key": key}
    assert validate_research_preference("appearance.theme", '"dark"') is None


@pytest.mark.integration
@pytest.mark.asyncio
async def test_research_preferences_gate_permissions_versions_and_session_reuse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", False)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.221", 49001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.222", 49002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as other,
    ):
        for client in (owner, other):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"research-preferences-{uuid4()}@example.com",
                    "password": "synthetic-preferences-password-123",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        body = {"settings": [{"key": "appearance.theme", "value": '"dark"', "version": 0}]}
        assert (
            await owner.put("/api/v1/users/me/settings", headers=csrf, json=body)
        ).status_code == 404
        assert (
            await owner.get("/api/v1/users/me/settings", params={"key": "appearance.theme"})
        ).status_code == 404
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        assert (await owner.put("/api/v1/users/me/settings", json=body)).status_code == 403
        untrusted = await owner.put(
            "/api/v1/users/me/settings",
            headers={**csrf, "Origin": "https://untrusted.example.com"},
            json=body,
        )
        assert untrusted.status_code == 403
        saved = await owner.put("/api/v1/users/me/settings", headers=csrf, json=body)
        assert saved.status_code == 200, saved.text
        assert saved.json()["settings"][0]["version"] == 1
        assert (
            await owner.put("/api/v1/users/me/settings", headers=csrf, json=body)
        ).status_code == 409
        assert (
            await other.get("/api/v1/users/me/settings", params={"key": "appearance.theme"})
        ).json() == {"settings": []}
        # A fresh client has no UI cache and reads the same account preference.
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test", cookies=owner.cookies
        ) as fresh:
            assert (
                await fresh.get("/api/v1/users/me/settings", params={"key": "appearance.theme"})
            ).json() == saved.json()
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        spaces = (await owner.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"]
        assert spaces
        context = {"workspace_id": workspace, "space_id": spaces[0]["id"]}
        context_body = {
            "settings": [{"key": "workbench.context", "value": json.dumps(context), "version": 0}]
        }
        updated = await owner.put("/api/v1/users/me/settings", headers=csrf, json=context_body)
        assert updated.status_code == 200, updated.text
        other_write = await other.put(
            "/api/v1/users/me/settings",
            headers={"X-CSRF-Token": other.cookies["logion_csrf"]},
            json=context_body,
        )
        assert other_write.status_code == 404
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (
            await owner.get("/api/v1/users/me/settings", params={"key": "workbench.context"})
        ).status_code == 404
        listed = (await owner.get("/api/v1/users/me/settings")).json()["settings"]
        assert all(item["key"] not in {"appearance.theme", "workbench.context"} for item in listed)
