import csv
import hashlib
import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
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
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_export_is_encrypted_complete_and_requester_scoped(tmp_path: Path) -> None:
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
            db.add(
                LearningGoal(
                    id=goal_id,
                    workspace_id=workspace_id,
                    space_id=viewer_private_space_id,
                    title="Other member private goal",
                    description="",
                    desired_outcome="",
                    created_by=viewer_id,
                    updated_by=viewer_id,
                )
            )
            await db.flush()
            db.add(
                LearningPlan(
                    id=plan_id,
                    workspace_id=workspace_id,
                    space_id=viewer_private_space_id,
                    goal_id=goal_id,
                    title="Other member private plan",
                    status="draft",
                    created_by=viewer_id,
                )
            )
            await db.flush()
            db.add(
                PlanVersion(
                    id=version_id,
                    workspace_id=workspace_id,
                    plan_id=plan_id,
                    version_number=1,
                    status="draft",
                    change_summary=private_plan_marker,
                    created_by=viewer_id,
                )
            )
            await db.flush()
            db.add(
                PlanPhase(
                    workspace_id=workspace_id,
                    plan_version_id=version_id,
                    title="Other member private phase",
                    description=private_plan_marker,
                    position=0,
                )
            )
            await db.commit()

        marker = f"export-private-{uuid4().hex}"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        owner_id = UUID(registrations[0].json()["user"]["id"])
        own_goal = uuid4()
        async with session_factory() as db:
            db.add(
                LearningGoal(
                    id=own_goal,
                    workspace_id=workspace_id,
                    space_id=space_id,
                    title="Portable goal",
                    description="",
                    desired_outcome="",
                    created_by=owner_id,
                    updated_by=owner_id,
                )
            )
            await db.commit()
        task_id = uuid4()
        task = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/tasks",
            headers=csrf,
            json={
                "id": str(task_id),
                "goal_id": str(own_goal),
                "phase_id": None,
                "title": "Portable task",
                "description": "Synthetic",
                "priority": 2,
                "estimated_minutes": 25,
            },
        )
        assert task.status_code == 201, task.text
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
        # Execute this synthetic job, without consuming another test's queue entry.
        async with session_factory() as db:
            job = await db.scalar(
                select(DataExportJob).where(DataExportJob.id == export_id).with_for_update()
            )
            assert job is not None
            if job.status == "queued":
                job.status = "running"
                job.started_at = datetime.now(UTC)
                job.version += 1
            await db.commit()
        await service.execute(export_id)
        listing = await owner.get(exports_url)
        assert listing.status_code == 200
        completed = listing.json()["exports"][0]
        assert completed["status"] == "succeeded"
        assert completed["artifact_sha256"]
        downloaded = await owner.get(f"{exports_url}/{export_id}/download")
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.headers["cache-control"] == "private, no-store"
        assert (
            downloaded.headers["content-disposition"]
            == f'attachment; filename="logion-export-{export_id}.zip"'
        )
        assert hashlib.sha256(downloaded.content).hexdigest() == completed["artifact_sha256"]
        assert len(downloaded.content) == completed["artifact_bytes"]
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
            assert archive.testzip() is None
            archive.extractall(tmp_path)
        manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["counts"] == {name: len(rows) for name, rows in package["objects"].items()}
        assert marker in (tmp_path / "notes.md").read_text(encoding="utf-8")
        with (tmp_path / "tasks.csv").open(encoding="utf-8", newline="") as task_file:
            task_rows = list(csv.DictReader(task_file))
        assert any(
            row["id"] == str(task_id) and row["estimated_minutes"] == "25" for row in task_rows
        )
        exported_text = "\n".join(
            (tmp_path / name).read_text(encoding="utf-8")
            for name in ("manifest.json", "data.json", "notes.md", "tasks.csv", "papers.bib")
        )
        for secret in ["a-strong-password-123", *owner.cookies.values(), *viewer.cookies.values()]:
            assert secret not in exported_text
        assert not (
            {"users", "password_credentials", "refresh_sessions", "devices"}
            & package["objects"].keys()
        )
        for rows in package["objects"].values():
            for row in rows:
                assert not (
                    {"password_hash", "token_hash", "refresh_token", "ciphertext", "api_key"}
                    & row.keys()
                )

        download_url = f"{exports_url}/{export_id}/download"
        async with AsyncClient(transport=ASGITransport(app=app), base_url=origin) as anonymous:
            assert (await anonymous.get(download_url)).status_code == 401
        assert (await viewer.get(download_url)).status_code == 404
        async with session_factory() as db:
            job = await db.get(DataExportJob, export_id)
            assert job is not None
            original_expiry = job.expires_at
            job.expires_at = datetime.now(UTC) - timedelta(seconds=1)
            await db.commit()
        expired = await owner.get(download_url)
        assert expired.status_code == 404
        assert expired.json()["code"] == "EXPORT_NOT_FOUND"
        async with session_factory() as db:
            job = await db.get(DataExportJob, export_id)
            assert job is not None
            job.expires_at = original_expiry
            await db.commit()
        stale_cookies = dict(owner.cookies)
        devices = (await owner.get("/api/v1/auth/devices")).json()["devices"]
        device_id = next(device["id"] for device in devices if device["current"])
        revoked = await owner.delete(f"/api/v1/auth/devices/{device_id}", headers=csrf)
        assert revoked.status_code == 200, revoked.text
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url=origin, cookies=stale_cookies
        ) as stale:
            assert (await stale.get(download_url)).status_code == 401

    async with session_factory() as db:
        stored = await db.get(DataExportJob, export_id)
        assert stored is not None
        assert marker.encode() not in (stored.artifact_ciphertext or b"")
        assert stored.artifact_sha256
