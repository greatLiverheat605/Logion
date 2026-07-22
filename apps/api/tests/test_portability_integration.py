import io
import json
import zipfile
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.models import WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService


@pytest.mark.integration
@pytest.mark.asyncio
async def test_export_is_encrypted_complete_and_requester_scoped() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.170", 49010)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.171", 49011)),
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
                        "email": f"portability-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        viewer_id = UUID(registrations[1].json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_id,
                    user_id=viewer_id,
                    role="viewer",
                    status="active",
                )
            )
            await db.commit()

        marker = f"export-private-{uuid4().hex}"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        note = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes",
            headers=csrf,
            json={
                "id": str(uuid4()),
                "task_id": None,
                "title": "Portable private note",
                "markdown_body": marker,
            },
        )
        assert note.status_code == 201, note.text
        export_id = uuid4()
        exports_url = f"/api/v1/workspaces/{workspace_id}/data-exports"
        created = await owner.post(
            exports_url,
            headers=csrf,
            json={"id": str(export_id), "confirmation": "EXPORT"},
        )
        assert created.status_code == 202, created.text
        assert (await viewer.get(exports_url)).json()["exports"] == []
        assert (await viewer.get(f"{exports_url}/{export_id}/download")).status_code == 404

        service = PortabilityService(get_settings(), WorkspaceService(get_settings()))
        await service.execute_next()
        listing = await owner.get(exports_url)
        assert listing.status_code == 200
        completed = listing.json()["exports"][0]
        assert completed["status"] == "succeeded"
        assert completed["artifact_sha256"]
        downloaded = await owner.get(f"{exports_url}/{export_id}/download")
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.headers["cache-control"] == "private, no-store"
        with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
            assert set(archive.namelist()) == {
                "manifest.json",
                "data.json",
                "notes.md",
                "tasks.csv",
                "papers.bib",
            }
            package = json.loads(archive.read("data.json"))
            assert package["schema_version"] == "logion-export-v1"
            assert package["objects"]["notes"][0]["markdown_body"] == marker
            assert "credentials" in package["excluded"]

    async with session_factory() as db:
        stored = await db.get(DataExportJob, export_id)
        assert stored is not None
        assert marker.encode() not in (stored.artifact_ciphertext or b"")
        assert stored.artifact_sha256
