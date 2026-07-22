import json
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.portability.models import DataImportPreview
from logion_api.workspaces.models import WorkspaceMembership


@pytest.mark.integration
@pytest.mark.asyncio
async def test_preview_first_import_is_private_new_id_and_single_use() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.172", 49012)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.173", 49013)),
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
                        "email": f"import-{label}-{uuid4()}@example.com",
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

        source_id = uuid4()
        marker = f"import-marker-{uuid4().hex}"
        package = json.dumps(
            {
                "schema_version": "logion-export-v1",
                "objects": {
                    "notes": [
                        {
                            "id": str(source_id),
                            "title": "Imported private note",
                            "markdown_body": marker,
                        }
                    ],
                    "tasks": [{"id": str(uuid4()), "title": "Skipped task"}],
                },
            }
        )
        preview_id = uuid4()
        imports_url = f"/api/v1/workspaces/{workspace_id}/data-imports"
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        preview = await owner.post(
            f"{imports_url}/preview",
            headers=csrf,
            json={
                "id": str(preview_id),
                "source_format": "logion_json",
                "source_filename": "data.json",
                "content": package,
            },
        )
        assert preview.status_code == 201, preview.text
        assert preview.json()["counts"] == {"note": 1}
        assert preview.json()["warnings"] == ["Skipped unsupported object type: tasks"]
        assert (await viewer.get(imports_url)).json()["imports"] == []
        denied = await viewer.post(
            f"{imports_url}/{preview_id}/commit",
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={
                "target_space_id": str(space_id),
                "expected_version": 1,
                "confirmation": "IMPORT",
            },
        )
        assert denied.status_code == 404
        committed = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": 1,
                "confirmation": "IMPORT",
            },
        )
        assert committed.status_code == 200, committed.text
        assert committed.json()["status"] == "imported"
        repeated = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": 2,
                "confirmation": "IMPORT",
            },
        )
        assert repeated.status_code == 409
        notes = await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes")
        imported = next(row for row in notes.json()["notes"] if row["markdown_body"] == marker)
        assert imported["id"] != str(source_id)

    async with session_factory() as db:
        stored = await db.get(DataImportPreview, preview_id)
        assert stored is not None and stored.status == "imported"
        assert stored.normalized_ciphertext is None
        assert marker not in str(stored.warnings)
