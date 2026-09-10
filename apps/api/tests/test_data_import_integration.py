import json
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Note
from logion_api.db import session_factory
from logion_api.main import app
from logion_api.portability.models import DataImportPreview
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import func, select


async def import_counts(workspace_id: UUID) -> tuple[int, int]:
    async with session_factory() as db:
        previews = await db.scalar(
            select(func.count(DataImportPreview.id)).where(
                DataImportPreview.workspace_id == workspace_id
            )
        )
        notes = await db.scalar(
            select(func.count(Note.id)).where(Note.workspace_id == workspace_id)
        )
        return int(previews or 0), int(notes or 0)


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
        counts_before = await import_counts(workspace_id)
        stale = await owner.post(
            f"{imports_url}/{preview_id}/commit",
            headers=csrf,
            json={
                "target_space_id": str(space_id),
                "expected_version": preview.json()["version"] + 1,
                "confirmation": "IMPORT",
            },
        )
        assert stale.status_code == 409
        assert stale.json()["code"] == "VERSION_CONFLICT"
        assert await import_counts(workspace_id) == counts_before
        unchanged = (await owner.get(imports_url)).json()["imports"]
        assert next(item for item in unchanged if item["id"] == str(preview_id)) == preview.json()
        async with session_factory() as db:
            stored = await db.get(DataImportPreview, preview_id)
            assert stored is not None and stored.normalized_ciphertext is not None
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
        counts_after = (counts_before[0], counts_before[1] + 1)
        assert await import_counts(workspace_id) == counts_after
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
        assert repeated.json()["code"] == "IMPORT_PREVIEW_EXPIRED"
        assert await import_counts(workspace_id) == counts_after
        search = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/search",
            headers=csrf,
            json={"query": marker, "object_types": ["note"], "limit": 10},
        )
        assert search.status_code == 200, search.text
        imported = search.json()["results"][0]
        assert imported["object_id"] != str(source_id)

    async with session_factory() as db:
        stored = await db.get(DataImportPreview, preview_id)
        assert stored is not None and stored.status == "imported"
        assert stored.normalized_ciphertext is None
        assert marker not in str(stored.warnings)


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("dimension", "size", "error_code"),
    [
        ("content", 0, "VALIDATION_ERROR"),
        ("content", 1, None),
        ("content", 1_048_576, None),
        ("content", 1_048_577, "VALIDATION_ERROR"),
        ("body", 0, None),
        ("body", 100_000, None),
        ("body", 100_001, "IMPORT_SOURCE_INVALID"),
        ("records", 0, "IMPORT_SOURCE_INVALID"),
        ("records", 1, None),
        ("records", 1000, None),
        ("records", 1001, "IMPORT_SOURCE_INVALID"),
    ],
)
async def test_import_preview_boundaries_preserve_business_data(
    dimension: str, size: int, error_code: str | None
) -> None:
    source_format = "logion_json"
    notes = [{"title": "Boundary note", "markdown_body": "x" * size if dimension == "body" else ""}]
    if dimension == "records":
        notes *= size
    content = json.dumps(
        {"schema_version": "logion-export-v1", "objects": {"notes": notes}},
        separators=(",", ":"),
    )
    if dimension == "content":
        if size <= 1:
            source_format, content = "markdown", "x" * size
        else:
            content = content.ljust(size)
        assert len(content) == size

    origin = "http://test"
    address = uuid4().hex
    client_ip = f"2001:db8::{address[:4]}:{address[4:8]}"
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(client_ip, 49014)),
        base_url=origin,
        headers={"Origin": origin},
    ) as owner:
        registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"import-boundary-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Import boundary test",
            },
        )
        assert registered.status_code == 201
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        counts_before = await import_counts(workspace_id)
        preview_id = uuid4()
        response = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/data-imports/preview",
            headers={"X-CSRF-Token": owner.cookies["logion_csrf"]},
            json={
                "id": str(preview_id),
                "source_format": source_format,
                "source_filename": "boundary.md"
                if source_format == "markdown"
                else "boundary.json",
                "content": content,
            },
        )
        if error_code is not None:
            assert response.status_code == 422
            assert response.json()["code"] == error_code
            assert await import_counts(workspace_id) == counts_before
            async with session_factory() as db:
                assert await db.get(DataImportPreview, preview_id) is None
        else:
            assert response.status_code == 201, response.text
            assert response.json()["counts"] == {"note": size if dimension == "records" else 1}
            assert await import_counts(workspace_id) == (counts_before[0] + 1, counts_before[1])
            async with session_factory() as db:
                stored = await db.get(DataImportPreview, preview_id)
                assert stored is not None and stored.status == "previewed"
                assert stored.normalized_ciphertext is not None
