import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient, Response
from logion_api.db import session_factory
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.workspaces.models import Workspace, WorkspaceMembership
from sqlalchemy import func, select


@pytest.mark.integration
@pytest.mark.asyncio
async def test_atomic_ownership_transfer_and_last_owner_protection() -> None:
    origin = "http://test"
    labels = ("owner", "owner_second", "target_a", "target_b", "outsider")
    clients = {
        label: AsyncClient(
            transport=ASGITransport(app=app, client=(f"192.0.2.{90 + index}", 49000 + index)),
            base_url=origin,
            headers={"Origin": origin},
        )
        for index, label in enumerate(labels)
    }
    users: dict[str, UUID] = {}
    csrf: dict[str, str] = {}
    emails: dict[str, str] = {}
    try:
        for label in ("owner", "target_a", "target_b", "outsider"):
            emails[label] = f"ownership-{label}-{uuid4()}@example.com"
            registered = await clients[label].post(
                "/api/v1/auth/register",
                json={
                    "email": emails[label],
                    "password": "a-strong-password-123",
                    "device_name": f"Ownership {label}",
                },
            )
            assert registered.status_code == 201, registered.text
            users[label] = UUID(registered.json()["user"]["id"])
            csrf[label] = clients[label].cookies["logion_csrf"]

        owner_second_login = await clients["owner_second"].post(
            "/api/v1/auth/login",
            json={
                "email": emails["owner"],
                "password": "a-strong-password-123",
                "device_name": "Ownership owner second session",
            },
        )
        assert owner_second_login.status_code == 200, owner_second_login.text
        csrf["owner_second"] = clients["owner_second"].cookies["logion_csrf"]

        owner_workspace = (await clients["owner"].get("/api/v1/workspaces")).json()[
            "workspaces"
        ][0]
        workspace_id = UUID(owner_workspace["id"])
        now = datetime.now(UTC)
        async with session_factory() as db:
            owner_membership = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == workspace_id,
                    WorkspaceMembership.user_id == users["owner"],
                )
            )
            assert owner_membership is not None
            target_a = WorkspaceMembership(
                workspace_id=workspace_id,
                user_id=users["target_a"],
                role="editor",
                status="active",
                joined_at=now,
            )
            target_b = WorkspaceMembership(
                workspace_id=workspace_id,
                user_id=users["target_b"],
                role="viewer",
                status="active",
                joined_at=now,
            )
            db.add_all((target_a, target_b))
            await db.commit()
            owner_membership_id = owner_membership.id
            target_ids = {"target_a": target_a.id, "target_b": target_b.id}

        owner_leave = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/me/leave",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 1},
        )
        assert owner_leave.status_code == 409
        assert owner_leave.json()["code"] == "OWNERSHIP_TRANSFER_REQUIRED"

        version_cases = (
            (2, 1, 1),
            (1, 2, 1),
            (1, 1, 2),
        )
        for workspace_version, owner_version, target_version in version_cases:
            stale = await clients["owner"].post(
                f"/api/v1/workspaces/{workspace_id}/ownership/transfer",
                headers={"X-CSRF-Token": csrf["owner"]},
                json={
                    "target_membership_id": str(target_ids["target_a"]),
                    "expected_workspace_version": workspace_version,
                    "expected_current_owner_version": owner_version,
                    "expected_target_version": target_version,
                    "previous_owner_role": "admin",
                },
            )
            assert stale.status_code == 409
            assert stale.json()["code"] == "OWNERSHIP_VERSION_CONFLICT"

        async with session_factory() as db:
            target_a = await db.get(WorkspaceMembership, target_ids["target_a"])
            assert target_a is not None
            target_a.status = "suspended"
            await db.commit()
        invalid_target = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/ownership/transfer",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={
                "target_membership_id": str(target_ids["target_a"]),
                "expected_workspace_version": 1,
                "expected_current_owner_version": 1,
                "expected_target_version": 1,
                "previous_owner_role": "admin",
            },
        )
        assert invalid_target.status_code == 409
        assert invalid_target.json()["code"] == "OWNERSHIP_TARGET_INVALID"
        async with session_factory() as db:
            target_a = await db.get(WorkspaceMembership, target_ids["target_a"])
            assert target_a is not None
            target_a.status = "active"
            await db.commit()

        async def transfer(client_label: str, target_label: str) -> Response:
            return await clients[client_label].post(
                f"/api/v1/workspaces/{workspace_id}/ownership/transfer",
                headers={"X-CSRF-Token": csrf[client_label]},
                json={
                    "target_membership_id": str(target_ids[target_label]),
                    "expected_workspace_version": 1,
                    "expected_current_owner_version": 1,
                    "expected_target_version": 1,
                    "previous_owner_role": "admin",
                },
            )

        first, second = await asyncio.gather(
            transfer("owner", "target_a"),
            transfer("owner_second", "target_b"),
        )
        assert sorted((first.status_code, second.status_code)) == [200, 403]
        succeeded = first if first.status_code == 200 else second
        new_owner_membership_id = UUID(succeeded.json()["new_owner"]["id"])
        new_owner_label = next(
            label
            for label, membership_id in target_ids.items()
            if membership_id == new_owner_membership_id
        )

        async with session_factory() as db:
            owner_count = int(
                await db.scalar(
                    select(func.count(WorkspaceMembership.id)).where(
                        WorkspaceMembership.workspace_id == workspace_id,
                        WorkspaceMembership.role == "owner",
                    )
                )
                or 0
            )
            assert owner_count == 1
            workspace = await db.get(Workspace, workspace_id)
            previous_owner = await db.get(WorkspaceMembership, owner_membership_id)
            new_owner = await db.get(WorkspaceMembership, new_owner_membership_id)
            assert workspace is not None and workspace.version == 2
            assert previous_owner is not None and previous_owner.role == "admin"
            assert previous_owner.version == 2
            assert new_owner is not None and new_owner.role == "owner"
            assert new_owner.version == 2

        previous_owner_view = await clients["owner"].get(f"/api/v1/workspaces/{workspace_id}")
        new_owner_view = await clients[new_owner_label].get(f"/api/v1/workspaces/{workspace_id}")
        assert previous_owner_view.status_code == 200
        assert previous_owner_view.json()["role"] == "admin"
        assert new_owner_view.status_code == 200
        assert new_owner_view.json()["role"] == "owner"

        new_owner_leave = await clients[new_owner_label].post(
            f"/api/v1/workspaces/{workspace_id}/members/me/leave",
            headers={"X-CSRF-Token": csrf[new_owner_label]},
            json={"expected_version": 2},
        )
        assert new_owner_leave.status_code == 409
        assert new_owner_leave.json()["code"] == "OWNERSHIP_TRANSFER_REQUIRED"

        previous_owner_leave = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/me/leave",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 2},
        )
        assert previous_owner_leave.status_code == 200
        assert previous_owner_leave.json()["status"] == "revoked"
        assert previous_owner_leave.json()["version"] == 3
        assert (await clients["owner"].get(f"/api/v1/workspaces/{workspace_id}")).status_code == 404
        replay_leave = await clients["owner"].post(
            f"/api/v1/workspaces/{workspace_id}/members/me/leave",
            headers={"X-CSRF-Token": csrf["owner"]},
            json={"expected_version": 3},
        )
        assert replay_leave.status_code == 404

        outsider_leave = await clients["outsider"].post(
            f"/api/v1/workspaces/{workspace_id}/members/me/leave",
            headers={"X-CSRF-Token": csrf["outsider"]},
            json={"expected_version": 1},
        )
        assert outsider_leave.status_code == 404

        async with session_factory() as db:
            audits = list(
                (
                    await db.scalars(
                        select(AuditEvent).where(
                            AuditEvent.event_type.in_(
                                ("workspace.ownership_transferred", "workspace.membership_left")
                            )
                        )
                    )
                ).all()
            )
            assert len(audits) >= 2
            metadata = " ".join(str(audit.event_metadata) for audit in audits)
            assert "@example.com" not in metadata
    finally:
        for client in clients.values():
            await client.aclose()
