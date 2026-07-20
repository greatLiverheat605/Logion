from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent, User
from logion_api.main import app
from logion_api.workspaces.models import Space, WorkspaceMembership
from sqlalchemy import func, select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_workspace_and_private_space_tenant_boundaries() -> None:
    origin = "http://test"
    headers = {"Origin": origin}
    email_a = f"workspace-a-{uuid4()}@example.com"
    email_b = f"workspace-b-{uuid4()}@example.com"

    async with (
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url=origin,
            headers=headers,
        ) as client_a,
        AsyncClient(
            transport=ASGITransport(app=app),
            base_url=origin,
            headers=headers,
        ) as client_b,
    ):
        registered_a = await client_a.post(
            "/api/v1/auth/register",
            json={
                "email": email_a,
                "password": "a-strong-password-123",
                "device_name": "Workspace browser A",
            },
        )
        assert registered_a.status_code == 201, registered_a.text
        user_a_id = UUID(registered_a.json()["user"]["id"])
        csrf_a = client_a.cookies["logion_csrf"]

        workspaces_a = await client_a.get("/api/v1/workspaces")
        assert workspaces_a.status_code == 200
        assert len(workspaces_a.json()["workspaces"]) == 1
        workspace_a = workspaces_a.json()["workspaces"][0]
        assert workspace_a["role"] == "owner"
        assert workspace_a["membership_status"] == "active"
        workspace_a_id = UUID(workspace_a["id"])

        initial_spaces_a = await client_a.get(f"/api/v1/workspaces/{workspace_a_id}/spaces")
        assert initial_spaces_a.status_code == 200
        assert len(initial_spaces_a.json()["spaces"]) == 1
        private_a = initial_spaces_a.json()["spaces"][0]
        assert private_a["visibility"] == "private"
        assert UUID(private_a["owner_user_id"]) == user_a_id

        missing_csrf = await client_a.post(
            f"/api/v1/workspaces/{workspace_a_id}/spaces",
            json={"name": "Missing CSRF", "visibility": "shared"},
        )
        assert missing_csrf.status_code == 403
        assert missing_csrf.json()["code"] == "AUTH_CSRF_INVALID"

        shared = await client_a.post(
            f"/api/v1/workspaces/{workspace_a_id}/spaces",
            headers={"X-CSRF-Token": csrf_a},
            json={"name": "Shared research", "visibility": "shared"},
        )
        assert shared.status_code == 201, shared.text
        shared_id = UUID(shared.json()["id"])

        registered_b = await client_b.post(
            "/api/v1/auth/register",
            json={
                "email": email_b,
                "password": "a-strong-password-123",
                "device_name": "Workspace browser B",
            },
        )
        assert registered_b.status_code == 201, registered_b.text
        user_b_id = UUID(registered_b.json()["user"]["id"])
        csrf_b = client_b.cookies["logion_csrf"]
        own_workspaces_b = await client_b.get("/api/v1/workspaces")
        workspace_b_id = UUID(own_workspaces_b.json()["workspaces"][0]["id"])

        cross_tenant = await client_b.get(f"/api/v1/workspaces/{workspace_a_id}")
        assert cross_tenant.status_code == 404
        assert cross_tenant.json()["code"] == "RESOURCE_NOT_FOUND"

        async with session_factory() as db:
            stored_user_b = await db.scalar(select(User).where(User.id == user_b_id))
            assert stored_user_b is not None
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace_a_id,
                    user_id=user_b_id,
                    role="viewer",
                    status="active",
                    joined_at=datetime.now(UTC),
                )
            )
            private_b = Space(
                workspace_id=workspace_a_id,
                owner_user_id=user_b_id,
                name="B private",
                visibility="private",
                created_by=user_b_id,
                updated_by=user_b_id,
            )
            db.add(private_b)
            await db.commit()
            private_b_id = private_b.id

        visible_to_a = await client_a.get(f"/api/v1/workspaces/{workspace_a_id}/spaces")
        visible_ids_a = {UUID(space["id"]) for space in visible_to_a.json()["spaces"]}
        assert shared_id in visible_ids_a
        assert UUID(private_a["id"]) in visible_ids_a
        assert private_b_id not in visible_ids_a

        visible_to_b = await client_b.get(f"/api/v1/workspaces/{workspace_a_id}/spaces")
        assert visible_to_b.status_code == 200
        visible_ids_b = {UUID(space["id"]) for space in visible_to_b.json()["spaces"]}
        assert shared_id in visible_ids_b
        assert private_b_id in visible_ids_b
        assert UUID(private_a["id"]) not in visible_ids_b

        owner_cannot_read_member_private = await client_a.get(
            f"/api/v1/workspaces/{workspace_a_id}/spaces/{private_b_id}"
        )
        assert owner_cannot_read_member_private.status_code == 404
        member_cannot_read_owner_private = await client_b.get(
            f"/api/v1/workspaces/{workspace_a_id}/spaces/{private_a['id']}"
        )
        assert member_cannot_read_owner_private.status_code == 404

        viewer_shared_create = await client_b.post(
            f"/api/v1/workspaces/{workspace_a_id}/spaces",
            headers={"X-CSRF-Token": csrf_b},
            json={"name": "Forbidden shared", "visibility": "shared"},
        )
        assert viewer_shared_create.status_code == 403
        assert viewer_shared_create.json()["code"] == "AUTHZ_PERMISSION_DENIED"

        viewer_private_create = await client_b.post(
            f"/api/v1/workspaces/{workspace_a_id}/spaces",
            headers={"X-CSRF-Token": csrf_b},
            json={"name": "B second private", "visibility": "private"},
        )
        assert viewer_private_create.status_code == 201, viewer_private_create.text
        assert UUID(viewer_private_create.json()["owner_user_id"]) == user_b_id

        mismatched_workspace = await client_a.get(
            f"/api/v1/workspaces/{workspace_b_id}/spaces/{shared_id}"
        )
        assert mismatched_workspace.status_code == 404

        async with session_factory() as db:
            denied_audits = int(
                await db.scalar(
                    select(func.count(AuditEvent.id)).where(
                        AuditEvent.event_type.in_(
                            (
                                "authorization.scope_denied",
                                "authorization.permission_denied",
                            )
                        )
                    )
                )
                or 0
            )
        assert denied_audits >= 5
