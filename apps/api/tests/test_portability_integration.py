import io
import json
import zipfile
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
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

        viewer_private = await viewer.post(
            f"/api/v1/workspaces/{workspace_id}/spaces",
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={"name": "Viewer private export boundary", "visibility": "private"},
        )
        assert viewer_private.status_code == 201, viewer_private.text
        viewer_private_space_id = UUID(viewer_private.json()["id"])
        private_plan_marker = f"other-private-plan-{uuid4().hex}"
        goal_id, plan_id, version_id = uuid4(), uuid4(), uuid4()
        async with session_factory() as db:
            db.add_all(
                [
                    LearningGoal(
                        id=goal_id,
                        workspace_id=workspace_id,
                        space_id=viewer_private_space_id,
                        title="Other member private goal",
                        description="",
                        desired_outcome="",
                        created_by=viewer_id,
                        updated_by=viewer_id,
                    ),
                    LearningPlan(
                        id=plan_id,
                        workspace_id=workspace_id,
                        space_id=viewer_private_space_id,
                        goal_id=goal_id,
                        title="Other member private plan",
                        status="draft",
                        created_by=viewer_id,
                    ),
                    PlanVersion(
                        id=version_id,
                        workspace_id=workspace_id,
                        plan_id=plan_id,
                        version_number=1,
                        status="draft",
                        change_summary=private_plan_marker,
                        created_by=viewer_id,
                    ),
                    PlanPhase(
                        workspace_id=workspace_id,
                        plan_version_id=version_id,
                        title="Other member private phase",
                        description=private_plan_marker,
                        position=0,
                    ),
                ]
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
            assert private_plan_marker not in json.dumps(package, ensure_ascii=False)
            assert "credentials" in package["excluded"]

    async with session_factory() as db:
        stored = await db.get(DataExportJob, export_id)
        assert stored is not None
        assert marker.encode() not in (stored.artifact_ciphertext or b"")
        assert stored.artifact_sha256
