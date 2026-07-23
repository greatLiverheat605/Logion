import hashlib
import json
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Resource
from logion_api.db import session_factory
from logion_api.execution.models import Task
from logion_api.growth.models import ShareSnapshot, TemplateInstallation, TemplatePackage
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[3]


def _example_package() -> tuple[dict[str, object], str]:
    package = json.loads(
        (ROOT / "examples/templates/ai-presemester-47-day.template.json").read_text(
            encoding="utf-8"
        )
    )
    source = ROOT / "archive/source-documents/learning-materials/01-2026-presemester-47-day-plan.md"
    return package, hashlib.sha256(source.read_bytes()).hexdigest()


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

        async with session_factory() as db:
            viewer_membership = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == viewer_id,
                )
            )
            assert viewer_membership is not None
            viewer_membership.role = "editor"
            viewer_membership.version += 1
            await db.commit()
        editor_listing = await viewer.get(shares_url)
        assert editor_listing.status_code == 200
        assert editor_listing.json()["shares"] == []
        editor_revoke = await viewer.post(
            f"{shares_url}/{share_id}/revoke",
            headers={"X-CSRF-Token": viewer.cookies["logion_csrf"]},
            json={"expected_version": 1},
        )
        assert editor_revoke.status_code == 404

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


@pytest.mark.integration
@pytest.mark.asyncio
async def test_original_47_day_template_import_is_bounded_private_and_date_preserving() -> None:
    package, source_sha256 = _example_package()
    assert source_sha256 == package["source_sha256"]
    assert sum(len(phase["tasks"]) for phase in package["goal_plan"]["phases"]) == 47
    package["package_id"] = str(uuid4())
    package["template_key"] = str(uuid4())

    origin = "http://test"
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.168", 49008)),
            base_url=origin,
            headers={"Origin": origin},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.169", 49009)),
            base_url=origin,
            headers={"Origin": origin},
        ) as outsider,
    ):
        responses = []
        for client, label in ((owner, "owner"), (outsider, "outsider")):
            responses.append(
                await client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"template-import-{label}-{uuid4()}@example.com",
                        "password": "a-strong-password-123",
                        "device_name": label,
                    },
                )
            )
        assert all(response.status_code == 201 for response in responses)
        workspace_id = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        outsider_workspace = UUID(
            (await outsider.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        )
        space_id = UUID(
            (await owner.get(f"/api/v1/workspaces/{workspace_id}/spaces")).json()["spaces"][0]["id"]
        )
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        imported = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/templates/import",
            headers=csrf,
            json=package,
        )
        assert imported.status_code == 201, imported.text
        imported_template_id = imported.json()["id"]
        assert imported_template_id != package["package_id"]
        assert imported.json()["visibility"] == "private"
        assert imported.json()["risk_metadata"]["external_link_count"] == 8
        assert "goal_plan" in imported.json()["object_graph"]

        cross_tenant = await owner.post(
            f"/api/v1/workspaces/{outsider_workspace}/templates/import",
            headers=csrf,
            json={**package, "package_id": str(uuid4()), "template_key": str(uuid4())},
        )
        assert cross_tenant.status_code == 404
        outsider_import = await outsider.post(
            f"/api/v1/workspaces/{outsider_workspace}/templates/import",
            headers={"X-CSRF-Token": outsider.cookies["logion_csrf"]},
            json=package,
        )
        assert outsider_import.status_code == 201, outsider_import.text
        assert outsider_import.json()["template_key"] != imported.json()["template_key"]
        replay = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/templates/import",
            headers=csrf,
            json=package,
        )
        assert replay.status_code == 409

        installation_payload = {
            "id": str(uuid4()),
            "template_id": imported_template_id,
            "target_space_id": str(space_id),
        }
        missing_date = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/template-installations",
            headers=csrf,
            json=installation_payload,
        )
        assert missing_date.status_code == 422

        start_date = date(2027, 7, 20)
        installation_id = UUID(installation_payload["id"])
        installed = await owner.post(
            f"/api/v1/workspaces/{workspace_id}/template-installations",
            headers=csrf,
            json={**installation_payload, "start_date": start_date.isoformat()},
        )
        assert installed.status_code == 201, installed.text
        ids = installed.json()["installed_object_ids"]
        assert len(ids["phase_ids"]) == 7
        assert len(ids["task_ids"]) == 47
        assert len(ids["resource_ids"]) == 8

    async with session_factory() as db:
        installation = await db.get(TemplateInstallation, installation_id)
        assert installation is not None
        tasks = list(
            (
                await db.scalars(
                    select(Task)
                    .where(Task.id.in_([UUID(value) for value in ids["task_ids"]]))
                    .order_by(Task.planned_at)
                )
            ).all()
        )
        assert len(tasks) == 47
        assert tasks[0].planned_at.date() == start_date
        assert tasks[-1].due_at is not None
        assert tasks[-1].due_at.date() == date(2027, 9, 4)
        assert (
            await db.scalar(
                select(func.count(Resource.id)).where(
                    Resource.id.in_([UUID(value) for value in ids["resource_ids"]])
                )
            )
        ) == 8
        assert (
            await db.scalar(
                select(func.count(Task.id)).where(
                    Task.workspace_id == outsider_workspace,
                    Task.id.in_([UUID(value) for value in ids["task_ids"]]),
                )
            )
            == 0
        )
