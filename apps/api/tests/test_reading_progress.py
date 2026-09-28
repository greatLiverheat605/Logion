from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reading_progress_preserves_metadata_requires_owner_and_versions(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", False)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.241", 49001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.242", 49002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        disabled = (
            f"/api/v1/workspaces/{uuid4()}/spaces/{uuid4()}"
            f"/library/resources/{uuid4()}/reading-status"
        )
        assert (
            await owner.patch(disabled, json={"expected_version": 1, "status": "reading"})
        ).status_code == 404
        users = []
        for client in (owner, peer):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"progress-{uuid4()}@example.com",
                    "password": "synthetic-progress-password-123",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
            users.append(UUID(registered.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        created_space = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Synthetic reading", "visibility": "shared"},
        )
        assert created_space.status_code == 201
        space = created_space.json()["id"]
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=users[1],
                    role="editor",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()
        monkeypatch.setattr(settings, "research_v3_enabled", True)
        base = f"/api/v1/workspaces/{workspace}/spaces/{space}/library/resources"
        created = await owner.post(
            base,
            json={
                "title": "Synthetic reading paper",
                "doi": "10.1234/progress",
                "tags": ["synthetic"],
                "csl": {"author": [{"literal": "Example Author"}]},
            },
        )
        assert created.status_code == 201
        original = created.json()
        path = f"{base}/{original['id']}/reading-status"
        progress = {"expected_version": 1, "status": "reading"}
        assert (await peer.patch(path, json=progress)).status_code == 404
        assert (
            await owner.patch(path, json=progress, headers={"X-CSRF-Token": ""})
        ).status_code == 403
        assert (
            await owner.patch(
                path, json=progress, headers={"Origin": "https://untrusted.example.com"}
            )
        ).status_code == 403
        assert (
            await owner.patch(path, json={**progress, "title": "must not overwrite"})
        ).status_code == 422
        assert (
            await owner.patch(path, json={**progress, "status": "close_read"})
        ).status_code == 409
        started = await owner.patch(path, json=progress)
        assert started.status_code == 200, started.text
        assert started.headers["cache-control"] == "private, no-store"
        assert started.json()["reading_status"] == "reading" and started.json()["version"] == 2
        assert started.json()["read_at"] is None
        for field in ("title", "doi", "tags", "csl", "file_locator"):
            assert started.json()[field] == original[field]
        assert (await owner.patch(path, json=progress)).status_code == 409
        repeated = await owner.patch(path, json={**progress, "expected_version": 2})
        assert repeated.json() == started.json()
        listed = await owner.get(base, params={"status": "reading"})
        assert [item["id"] for item in listed.json()["resources"]] == [original["id"]]
        assert (await peer.get(base, params={"status": "reading"})).json()["resources"] == []
        completed = await owner.patch(path, json={"status": "close_read", "expected_version": 2})
        assert completed.status_code == 200, completed.text
        assert (
            completed.json()["version"] == 3 and completed.json()["reading_status"] == "close_read"
        )
        assert datetime.fromisoformat(completed.json()["read_at"]).tzinfo is not None
        assert (await owner.get(base, params={"status": "reading"})).json()["resources"] == []
        assert (
            len((await owner.get(base, params={"status": "close_read"})).json()["resources"]) == 1
        )
        reopened = await owner.patch(path, json={"status": "reading", "expected_version": 3})
        assert (
            reopened.status_code == 200
            and reopened.json()["read_at"] == completed.json()["read_at"]
        )
        async with session_factory() as db:
            resource = await db.get(Resource, UUID(original["id"]))
            resource.reading_status = "archived"
            await db.commit()
        assert (await owner.patch(path, json={"status": "reading", "expected_version": 4})).json()[
            "code"
        ] == "READING_TRANSITION_INVALID"
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (
            await owner.patch(path, json={"status": "reading", "expected_version": 4})
        ).status_code == 404
