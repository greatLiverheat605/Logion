import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from logion_api.content.models import Note
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuditEvent, AuthSession, User
from logion_api.portability.models import DataExportJob
from logion_api.portability.research_export import research_records
from logion_api.sync.models import SyncChange
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import select
from test_online_notes_integration import create as create_note
from test_online_planning_integration import online_case as online_case

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def path(c):
    return f"/api/v1/workspaces/{c['ws']}/research/spaces"


async def change(c, status="archived", version=1, space_id=None, **kwargs):
    return await c["client"].patch(
        f"{path(c)}/{space_id or c['sp']}/archive",
        json={"expected_version": version, "status": status},
        headers=kwargs.pop("headers", c["csrf"]),
        **kwargs,
    )


async def bootstrap(c, snapshot=None):
    return await c["client"].post(
        f"/api/v1/workspaces/{c['ws']}/sync/bootstrap",
        headers={"X-Logion-Sync-Capabilities": "entity-deletion-v1"},
        json={
            "protocol_version": "sync-v1",
            "message_type": "bootstrap_request",
            "workspace_id": c["ws"],
            "device_id": c["pull"]["device_id"],
            "known_sync_epoch": c["pull"]["sync_epoch"],
            "snapshot_id": snapshot,
            "chunk_index": 0,
        },
    )


async def test_archive_restore_preserves_notes_and_refreshes_existing_sync(online_case):
    c = online_case
    note = await create_note(c)
    before = await bootstrap(c)
    assert before.status_code == 200, before.text
    assert any(r["entity_id"] == note["id"] for r in before.json()["records"])
    result = await change(c)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "archived" and result.json()["version"] == 2
    ordinary = f"/api/v1/workspaces/{c['ws']}/spaces"
    assert (await c["client"].get(ordinary)).json()["spaces"] == []
    assert (await c["client"].get(c["path"].replace("/goals", "/notes"))).status_code == 404
    listed = (await c["client"].get(path(c), params={"status": "archived"})).json()
    assert [s["id"] for s in listed["spaces"]] == [c["sp"]]
    assert (await bootstrap(c, before.json()["snapshot_id"])).status_code == 409
    empty = (await bootstrap(c)).json()
    assert empty["records"] == []
    assert empty["sync_epoch"] == before.json()["sync_epoch"]
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        user.email_verified_at = utc_now()
        await db.flush()
        archive = await research_records(
            db,
            DataExportJob(
                id=uuid4(),
                workspace_id=UUID(c["ws"]),
                requested_by=user.id,
            ),
        )
        assert archive["spaces"][0]["status"] == "archived"
        assert any(row["id"] == note["id"] for row in archive["notes"])
        await db.commit()
    pull = await c["client"].post(f"/api/v1/workspaces/{c['ws']}/sync/pull", json=c["pull"])
    assert pull.json()["action"] == "cursor_expired", pull.text
    assert pull.json()["server_sync_epoch"] == c["pull"]["sync_epoch"]
    restored = await change(c, "active", 2)
    assert restored.status_code == 200 and restored.json()["version"] == 3
    snapshot = (await bootstrap(c)).json()
    assert snapshot["sync_epoch"] == empty["sync_epoch"]
    returned = [r for r in snapshot["records"] if r["entity_id"] == note["id"]]
    assert returned[0]["version"] == note["version"]
    assert (await bootstrap(c, empty["snapshot_id"])).status_code == 409
    async with session_factory() as db:
        row = await db.get(Note, UUID(note["id"]))
        assert row.deleted_at is None and row.version == 1
        changes = list(
            await db.scalars(
                select(SyncChange).where(
                    SyncChange.workspace_id == UUID(c["ws"]), SyncChange.entity_type == "space"
                )
            )
        )
        assert len(changes) == 2
        assert all(
            set(row.payload) == {"name", "visibility"} and not row.tombstone for row in changes
        )
        audit = list(
            await db.scalars(
                select(AuditEvent).where(
                    AuditEvent.workspace_id == UUID(c["ws"]),
                    AuditEvent.event_type.in_(("space.archived", "space.active")),
                )
            )
        )
        assert len(audit) == 2 and all(not row.event_metadata for row in audit)


async def test_archive_flags_csrf_origin_recent_auth_and_stale_version(online_case):
    c = online_case
    assert (await change(c, headers={})).status_code == 403
    assert (
        await change(c, headers={**c["csrf"], "Origin": "http://foreign.invalid"})
    ).status_code == 403
    assert (await change(c, version=2)).status_code == 409
    assert (await change(c, status="deleted")).status_code == 422
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(path(c))).status_code == 404
    assert (await change(c)).status_code == 404
    c["flags"]["research_v3_enabled"] = True
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        sessions = list(await db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)))
        for session in sessions:
            session.created_at = utc_now() - timedelta(days=1)
        await db.commit()
    result = await change(c)
    assert result.status_code == 403 and result.json()["code"] == "AUTH_RECENT_LOGIN_REQUIRED"
    assert (await c["client"].get(path(c))).json()["spaces"][0]["status"] == "active"


async def test_management_is_private_and_shared_lifecycle_requires_admin(online_case):
    c = online_case
    async with session_factory() as db:
        own = await db.get(Space, UUID(c["sp"]))
        email = f"space-peer-{uuid4()}@example.com"
        peer = User(email=email, email_normalized=email)
        db.add(peer)
        await db.flush()
        foreign = Space(
            workspace_id=own.workspace_id,
            owner_user_id=peer.id,
            name="PRIVATE_SENTINEL",
            visibility="private",
            status="archived",
            created_by=peer.id,
            updated_by=peer.id,
        )
        shared = Space(
            workspace_id=own.workspace_id,
            owner_user_id=None,
            name="Shared",
            visibility="shared",
            created_by=own.owner_user_id,
            updated_by=own.owner_user_id,
        )
        deleted = Space(
            workspace_id=own.workspace_id,
            owner_user_id=own.owner_user_id,
            name="Deleted",
            visibility="private",
            status="deleted",
            deleted_at=utc_now(),
            created_by=own.owner_user_id,
            updated_by=own.owner_user_id,
        )
        db.add_all([foreign, shared, deleted])
        await db.commit()
        foreign_id, shared_id, deleted_id = foreign.id, shared.id, deleted.id
    first = await c["client"].get(path(c), params={"limit": 1})
    second = await c["client"].get(
        path(c), params={"limit": 1, "cursor": first.json()["next_cursor"]}
    )
    assert len(first.json()["spaces"]) == len(second.json()["spaces"]) == 1
    assert second.json()["next_cursor"] is None
    assert "PRIVATE_SENTINEL" not in first.text + second.text
    for sid in (foreign_id, deleted_id, uuid4()):
        assert (await change(c, space_id=sid)).status_code == 404
    async with session_factory() as db:
        member = await db.scalar(
            select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
        )
        member.role = "editor"
        await db.commit()
    listed = (await c["client"].get(path(c))).json()["spaces"]
    assert not next(s for s in listed if s["id"] == str(shared_id))["can_manage"]
    assert (await change(c, space_id=shared_id)).status_code == 403
    assert (await change(c)).status_code == 200  # Own private Space is still manageable.
    async with session_factory() as db:
        member = await db.scalar(
            select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
        )
        member.role = "admin"
        await db.commit()
    assert (await change(c, space_id=shared_id)).status_code == 200


async def test_archive_rechecks_membership_after_workspace_lock(online_case, monkeypatch):
    c = online_case
    observed = asyncio.Event()
    original = WorkspaceService.resolve_workspace

    async def observe(self, *args, **kwargs):
        value = await original(self, *args, **kwargs)
        observed.set()
        return value

    monkeypatch.setattr(WorkspaceService, "resolve_workspace", observe)
    async with session_factory() as db:
        await db.scalar(select(Workspace.id).where(Workspace.id == UUID(c["ws"])).with_for_update())
        pending = asyncio.create_task(change(c))
        try:
            await asyncio.wait_for(observed.wait(), timeout=5)
            member = await db.scalar(
                select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
            )
            member.status = "revoked"
            await db.commit()
            assert (await asyncio.wait_for(pending, timeout=5)).status_code == 404
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    async with session_factory() as db:
        row = await db.get(Space, UUID(c["sp"]))
        assert row.status == "active" and row.version == 1


async def test_archive_ledger_failure_rolls_back_status(online_case, monkeypatch):
    c = online_case

    async def fail(*_args, **_kwargs):
        raise RuntimeError("synthetic lifecycle ledger failure")

    monkeypatch.setattr(SyncLedgerService, "append_applied", fail)
    with pytest.raises(RuntimeError, match="synthetic lifecycle ledger failure"):
        await change(c)
    async with session_factory() as db:
        row = await db.get(Space, UUID(c["sp"]))
        assert row.status == "active" and row.version == 1


@pytest.mark.parametrize("status", ["archived", "deleted"])
async def test_legacy_note_writer_rechecks_space_after_lock_wait(online_case, monkeypatch, status):
    c = online_case
    note = await create_note(c)
    observed = asyncio.Event()
    original = WorkspaceService.resolve_space

    async def observe(self, *args, **kwargs):
        value = await original(self, *args, **kwargs)
        observed.set()
        return value

    monkeypatch.setattr(WorkspaceService, "resolve_space", observe)
    async with session_factory() as db:
        row = await db.scalar(select(Space).where(Space.id == UUID(c["sp"])).with_for_update())
        pending = asyncio.create_task(
            c["client"].put(
                c["path"].replace("research/goals", f"notes/{note['id']}"),
                headers=c["csrf"],
                json={
                    "expected_version": 1,
                    "title": "Must not commit",
                    "markdown_body": "Blocked",
                },
            )
        )
        try:
            await asyncio.wait_for(observed.wait(), timeout=5)
            row.status = status
            row.deleted_at = utc_now() if status == "deleted" else None
            await db.commit()
            assert (await asyncio.wait_for(pending, timeout=5)).status_code == 404
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    async with session_factory() as db:
        note_row = await db.get(Note, UUID(note["id"]))
        assert note_row.version == 1 and note_row.title == note["title"]
