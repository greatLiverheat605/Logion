from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Note, Resource
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_note_and_resource_crud_security_and_tenant_boundary() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.83", 48003)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.84", 48004)),
            base_url=origin,
            headers={"Origin": origin},
        ) as other,
    ):
        registered = await owner.post(
            "/api/v1/auth/register",
            json={
                "email": f"content-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Content browser",
            },
        )
        assert registered.status_code == 201
        csrf = owner.cookies["logion_csrf"]
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        note_id = uuid4()
        private_body = "# Result\n\n<script>alert('stored only')</script>\nprivate finding"
        note_payload = {
            "id": str(note_id),
            "task_id": None,
            "title": "Experiment note",
            "markdown_body": private_body,
        }
        missing_csrf = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes", json=note_payload
        )
        assert missing_csrf.status_code == 403
        created = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes",
            headers={"X-CSRF-Token": csrf},
            json=note_payload,
        )
        assert created.status_code == 201, created.text
        assert created.json()["markdown_body"] == private_body
        updated = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes/{note_id}",
            headers={"X-CSRF-Token": csrf},
            json={
                "expected_version": 1,
                "task_id": None,
                "title": "Experiment note revised",
                "markdown_body": private_body,
            },
        )
        assert updated.status_code == 200
        stale = await owner.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes/{note_id}",
            headers={"X-CSRF-Token": csrf},
            json={
                "expected_version": 1,
                "task_id": None,
                "title": "Stale",
                "markdown_body": "stale",
            },
        )
        assert stale.status_code == 409

        resource_id = uuid4()
        resource = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/resources",
            headers={"X-CSRF-Token": csrf},
            json={
                "id": str(resource_id),
                "task_id": None,
                "resource_type": "pdf_index",
                "title": "Indexed paper",
                "source_url": "https://example.com/paper.pdf",
                "pdf_filename": "paper.pdf",
                "page_count": 12,
                "sha256": "a" * 64,
                "page_index": [
                    {"page": 3, "label": "Method", "note": "Compare assumptions"},
                    {"page": 9, "label": "Limitations", "note": "Review threats"},
                ],
            },
        )
        assert resource.status_code == 201, resource.text
        assert resource.json()["page_index"][1]["page"] == 9

        other_registered = await other.post(
            "/api/v1/auth/register",
            json={
                "email": f"content-other-{uuid4()}@example.com",
                "password": "a-strong-password-123",
                "device_name": "Other browser",
            },
        )
        assert other_registered.status_code == 201
        cross_tenant = await other.put(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/notes/{note_id}",
            headers={"X-CSRF-Token": other.cookies["logion_csrf"]},
            json={
                "expected_version": 2,
                "task_id": None,
                "title": "Cross tenant",
                "markdown_body": "forbidden",
            },
        )
        assert cross_tenant.status_code == 404

    async with session_factory() as db:
        assert (await db.get(Note, note_id)).version == 2  # type: ignore[union-attr]
        assert await db.get(Resource, resource_id) is not None
        audits = list(
            await db.scalars(
                select(AuditEvent).where(AuditEvent.target_id.in_([note_id, resource_id]))
            )
        )
        assert {item.event_type for item in audits} == {
            "content.note_created",
            "content.note_updated",
            "content.resource_created",
        }
        assert all(private_body not in str(item.event_metadata) for item in audits)
