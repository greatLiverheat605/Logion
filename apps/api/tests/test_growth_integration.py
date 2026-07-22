from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.db import session_factory
from logion_api.growth.models import ShareSnapshot, TemplateInstallation, TemplatePackage
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_template_install_and_revocable_minimal_share() -> None:
    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.166", 49006)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.167", 49007)),
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
                        "email": f"growth-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in registrations)
        viewer_id = UUID(registrations[1].json()["user"]["id"])
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        external_workspace_id = UUID(
            (await viewer.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
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
                    joined_at=datetime.now(UTC),
                )
            )
            await db.commit()

        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        goal_id = uuid4()
        goal_payload = {
            "goal_id": str(goal_id),
            "plan_id": str(uuid4()),
            "plan_version_id": str(uuid4()),
            "title": "User-defined learning goal",
            "description": "Private detail that is not selected for sharing",
            "desired_outcome": "A verifiable user outcome",
            "weekly_minutes": 300,
            "target_date": "2027-01-15",
            "phases": [
                {
                    "id": str(uuid4()),
                    "title": "User-defined phase",
                    "description": "No hard-coded subject context",
                    "position": 0,
                    "estimated_minutes": 600,
                    "acceptance_criteria": ["User-defined criterion"],
                }
            ],
        }
        created_goal = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals",
            headers=csrf,
            json=goal_payload,
        )
        assert created_goal.status_code == 201, created_goal.text

        template_id, template_key = uuid4(), uuid4()
        template_payload = {
            "id": str(template_id),
            "template_key": str(template_key),
            "previous_template_id": None,
            "source_space_id": str(space_id),
            "source_goal_id": str(goal_id),
            "name": "Private reusable plan",
            "description": "Created from authorized structured objects",
            "product_min_version": "0.1.0",
            "author_name": "Workspace user",
            "license": "CC-BY-4.0",
            "locale": "en-US",
            "target_personas": ["self-study"],
            "changelog": "Initial version",
            "visibility": "private",
        }
        templates_url = f"/api/v1/workspaces/{workspace_id}/templates"
        assert (
            await owner.post(f"{templates_url}/from-goal", json=template_payload)
        ).status_code == 403
        blocked_workspace = await owner.post(
            f"{templates_url}/from-goal",
            headers=csrf,
            json={**template_payload, "id": str(uuid4()), "visibility": "workspace"},
        )
        assert blocked_workspace.status_code == 422
        template = await owner.post(
            f"{templates_url}/from-goal", headers=csrf, json=template_payload
        )
        assert template.status_code == 201, template.text
        assert template.json()["version_number"] == 1
        assert template.json()["risk_metadata"]["contains_executable"] is False
        assert (await viewer.get(templates_url)).json()["templates"] == []
        assert (
            await owner.get(f"/api/v1/workspaces/{external_workspace_id}/templates")
        ).status_code == 404

        second_version = await owner.post(
            f"{templates_url}/from-goal",
            headers=csrf,
            json={
                **template_payload,
                "id": str(uuid4()),
                "previous_template_id": str(template_id),
                "changelog": "Second immutable version",
            },
        )
        assert second_version.status_code == 201, second_version.text
        assert second_version.json()["version_number"] == 2

        installation_id = uuid4()
        installation = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/template-installations",
            headers=csrf,
            json={
                "id": str(installation_id),
                "template_id": str(template_id),
                "target_space_id": str(space_id),
            },
        )
        assert installation.status_code == 201, installation.text
        installed_goal_id = installation.json()["installed_object_ids"]["goal_id"]
        assert installed_goal_id != str(goal_id)

        share_id = uuid4()
        shares_url = f"/api/v1/workspaces/{workspace_id}/shares"
        share = await owner.post(
            shares_url,
            headers=csrf,
            json={
                "id": str(share_id),
                "source_space_id": str(space_id),
                "source_goal_id": str(goal_id),
                "title": "Minimal read-only snapshot",
                "fields": ["title", "phases"],
                "expires_in_days": 30,
            },
        )
        assert share.status_code == 201, share.text
        token = share.json()["token"]
        assert token not in (await owner.get(shares_url)).text
        assert (await viewer.get(shares_url)).status_code == 403

        public = await viewer.get(f"/api/v1/shares/{token}")
        assert public.status_code == 200, public.text
        assert public.headers["cache-control"] == "private, no-store"
        assert set(public.json()["snapshot"]) == {"title", "phases"}
        assert "Private detail" not in public.text
        revoked = await owner.post(
            f"{shares_url}/{share_id}/revoke",
            headers=csrf,
            json={"expected_version": 1},
        )
        assert revoked.status_code == 200, revoked.text
        assert revoked.json()["status"] == "revoked"
        assert (await viewer.get(f"/api/v1/shares/{token}")).status_code == 404

    async with session_factory() as db:
        template_row = await db.get(TemplatePackage, template_id)
        installation_row = await db.get(TemplateInstallation, installation_id)
        share_row = await db.get(ShareSnapshot, share_id)
        assert template_row is not None
        assert installation_row is not None
        assert share_row is not None and share_row.status == "revoked"
        assert share_row.token_hash != token
        audit_rows = list(
            (
                await db.scalars(select(AuditEvent).where(AuditEvent.workspace_id == workspace_id))
            ).all()
        )
        audit_text = " ".join(str(row.event_metadata) for row in audit_rows)
        assert token not in audit_text
        assert "Private detail" not in audit_text
