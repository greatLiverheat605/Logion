import asyncio
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from logion_api.content.models import Note
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuditEvent, AuthSession, User
from logion_api.memory.models import KnowledgeSourceLink
from logion_api.portability.models import DataExportJob
from logion_api.portability.research_export import research_records
from logion_api.sync.models import SyncChange
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import select
from test_online_notes_integration import create as create_note
from test_online_planning_integration import online_case as online_case
from test_space_lifecycle import bootstrap, path
from test_space_lifecycle import change as archive

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


async def change(c, action="delete", version=1, space_id=None, **kwargs):
    payload = {
        "expected_version": version,
        "action": action,
        "confirmation": "DELETE SPACE" if action == "delete" else "RESTORE SPACE",
    }
    payload.update(kwargs.pop("payload", {}))
    return await c["client"].patch(
        f"{path(c)}/{space_id or c['sp']}/deletion",
        json=payload,
        headers=kwargs.pop("headers", c["csrf"]),
        **kwargs,
    )


async def test_delete_retains_rows_and_restores_to_archive_without_resurrecting_children(
    online_case,
):
    c = online_case
    note = await create_note(c)
    removed = await create_note(c)
    before = (await bootstrap(c)).json()
    async with session_factory() as db:
        child = await db.get(Note, UUID(removed["id"]))
        child.deleted_at = utc_now()
        child.version += 1
        user = await db.scalar(select(User).where(User.email == c["email"]))
        user.email_verified_at = utc_now()
        await db.commit()
        user_id = user.id
    result = await change(c)
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "deleted" and result.json()["version"] == 2
    assert result.json()["deleted_at"] is not None
    assert (await c["client"].get(path(c))).json()["spaces"] == []
    rows = (await c["client"].get(path(c) + "/deleted")).json()["spaces"]
    assert len(rows) == 1 and rows[0]["id"] == c["sp"] and rows[0]["can_manage"]
    note_path = c["path"].replace("/goals", "/notes")
    assert (await c["client"].get(f"{note_path}/{note['id']}")).status_code == 404
    assert (
        await c["client"].put(
            note_path.replace("/research/", "/") + "/" + note["id"],
            headers=c["csrf"],
            json={
                "expected_version": 1,
                "title": "Must remain hidden",
                "markdown_body": "No write",
            },
        )
    ).status_code == 404
    assert (await archive(c, "active", 2)).status_code == 404
    assert (await change(c, version=2)).status_code == 404
    assert (await bootstrap(c, before["snapshot_id"])).status_code == 409
    hidden = (await bootstrap(c)).json()
    assert hidden["records"] == [] and hidden["sync_epoch"] == before["sync_epoch"]
    pull = await c["client"].post(f"/api/v1/workspaces/{c['ws']}/sync/pull", json=c["pull"])
    assert pull.json()["action"] == "cursor_expired"
    async with session_factory() as db:
        export = await research_records(
            db, DataExportJob(id=uuid4(), workspace_id=UUID(c["ws"]), requested_by=user_id)
        )
        assert export["spaces"] == [] and export["notes"] == []
        row = await db.get(Space, UUID(c["sp"]))
        row.deleted_at = utc_now() - timedelta(days=3650)
        await db.commit()
    restored = await change(c, "restore", 2)
    assert restored.status_code == 200, restored.text
    assert restored.json() == {
        "id": c["sp"],
        "status": "archived",
        "version": 3,
        "deleted_at": None,
    }
    assert (await c["client"].get(path(c) + "/deleted")).json()["spaces"] == []
    assert (await c["client"].get(f"{note_path}/{note['id']}")).status_code == 404
    assert (await archive(c, "active", 3)).status_code == 200
    assert (await c["client"].get(f"{note_path}/{note['id']}")).status_code == 200
    assert (await c["client"].get(f"{note_path}/{removed['id']}")).status_code == 404
    returned = (await bootstrap(c)).json()
    assert any(r["entity_id"] == note["id"] and r["version"] == 1 for r in returned["records"])
    assert not any(r["entity_id"] == removed["id"] for r in returned["records"])
    assert returned["sync_epoch"] == before["sync_epoch"]
    async with session_factory() as db:
        child = await db.get(Note, UUID(note["id"]))
        assert child.deleted_at is None and child.version == 1
        removed_child = await db.get(Note, UUID(removed["id"]))
        assert removed_child.deleted_at is not None and removed_child.version == 2
        events = list(
            await db.scalars(
                select(AuditEvent).where(
                    AuditEvent.workspace_id == UUID(c["ws"]),
                    AuditEvent.event_type.in_(("space.deleted", "space.restored")),
                )
            )
        )
        assert len(events) == 2 and all(not e.event_metadata for e in events)
        changes = list(
            await db.scalars(
                select(SyncChange).where(
                    SyncChange.workspace_id == UUID(c["ws"]), SyncChange.entity_type == "space"
                )
            )
        )
        assert len(changes) == 3
        assert all(not r.tombstone and set(r.payload) == {"name", "visibility"} for r in changes)


async def test_delete_archive_and_validation_security_boundaries(online_case):
    c = online_case
    for action in ("delete", "restore"):
        assert (await change(c, action, headers={})).status_code == 403
        assert (
            await change(c, action, headers={**c["csrf"], "Origin": "http://foreign.invalid"})
        ).status_code == 403
        assert (await change(c, action, payload={"confirmation": "invalid"})).status_code == 422
    assert (await change(c, payload={"confirmation": "RESTORE SPACE"})).status_code == 422
    assert (await change(c, version=3)).status_code == 409
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(path(c) + "/deleted")).status_code == 404
    assert (await change(c)).status_code == 404
    c["flags"]["research_v3_enabled"] = True
    assert (await archive(c)).status_code == 200
    assert (await change(c, version=2)).status_code == 200
    assert (await change(c, "restore", 2)).status_code == 409
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        for session in await db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)):
            session.created_at = utc_now() - timedelta(days=1)
        await db.commit()
    restore = await change(c, "restore", 3)
    assert restore.status_code == 403 and restore.json()["code"] == "AUTH_RECENT_LOGIN_REQUIRED"
    assert (await c["client"].get(path(c) + "/deleted")).json()["spaces"][0]["version"] == 3


async def test_deleted_list_is_scoped_paginated_and_shared_actions_require_admin(online_case):
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
            name="PRIVATE_DELETED_SENTINEL",
            visibility="private",
            status="deleted",
            deleted_at=utc_now(),
            created_by=peer.id,
            updated_by=peer.id,
        )
        shared = Space(
            workspace_id=own.workspace_id,
            owner_user_id=None,
            name="Shared",
            visibility="shared",
            status="deleted",
            deleted_at=utc_now(),
            created_by=own.owner_user_id,
            updated_by=own.owner_user_id,
        )
        db.add_all([foreign, shared])
        await db.commit()
        foreign_id, shared_id = foreign.id, shared.id
    assert (await change(c)).status_code == 200
    first = await c["client"].get(path(c) + "/deleted", params={"limit": 1})
    second = await c["client"].get(
        path(c) + "/deleted", params={"limit": 1, "cursor": first.json()["next_cursor"]}
    )
    assert len(first.json()["spaces"]) == len(second.json()["spaces"]) == 1
    assert second.json()["next_cursor"] is None
    assert "PRIVATE_DELETED_SENTINEL" not in first.text + second.text
    for sid in (foreign_id, uuid4()):
        assert (await change(c, "restore", space_id=sid)).status_code == 404
    for role in ("viewer", "editor"):
        async with session_factory() as db:
            member = await db.scalar(
                select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
            )
            member.role = role
            await db.commit()
        listed = (await c["client"].get(path(c) + "/deleted")).json()["spaces"]
        assert not next(s for s in listed if s["id"] == str(shared_id))["can_manage"]
        assert (await change(c, "restore", space_id=shared_id)).status_code == 403
    async with session_factory() as db:
        member = await db.scalar(
            select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
        )
        member.role = "admin"
        await db.commit()
    assert (await change(c, "restore", space_id=shared_id)).status_code == 200
    assert (await change(c, version=2, space_id=shared_id)).status_code == 200


async def test_external_legacy_reference_blocks_entire_deletion_without_leaking_details(
    online_case,
):
    c = online_case
    note = await create_note(c)
    async with session_factory() as db:
        own = await db.get(Space, UUID(c["sp"]))
        sibling = Space(
            workspace_id=own.workspace_id,
            owner_user_id=own.owner_user_id,
            name="Sibling",
            visibility="private",
            created_by=own.owner_user_id,
            updated_by=own.owner_user_id,
        )
        db.add(sibling)
        await db.flush()
        link = KnowledgeSourceLink(
            workspace_id=own.workspace_id,
            space_id=sibling.id,
            source_kind="note",
            source_id=UUID(note["id"]),
            target_kind="topic",
            target_id=uuid4(),
            excerpt_sha256="a" * 64,
            excerpt_start=0,
            excerpt_end=1,
            source_version=1,
            created_by=own.owner_user_id,
            updated_by=own.owner_user_id,
        )
        db.add(link)
        await db.commit()
        link_id = link.id
    result = await change(c)
    assert result.status_code == 409, result.text
    assert result.json()["code"] == "SPACE_DELETE_BLOCKED_BY_REFERENCE"
    assert str(link_id) not in result.text and "Sibling" not in result.text
    async with session_factory() as db:
        row = await db.get(Space, UUID(c["sp"]))
        assert row.status == "active" and row.version == 1 and row.deleted_at is None
        link = await db.get(KnowledgeSourceLink, link_id)
        link.space_id = row.id  # Internal references stay with the aggregate.
        await db.commit()
    assert (await change(c)).status_code == 200
    async with session_factory() as db:
        link = await db.get(KnowledgeSourceLink, link_id)
        assert link.deleted_at is None and link.version == 1


@pytest.mark.parametrize("action", ["delete", "restore"])
async def test_deletion_rechecks_membership_after_workspace_lock(online_case, monkeypatch, action):
    c = online_case
    if action == "restore":
        assert (await change(c)).status_code == 200
    observed = asyncio.Event()
    original = WorkspaceService.resolve_workspace

    async def observe(self, *args, **kwargs):
        value = await original(self, *args, **kwargs)
        observed.set()
        return value

    monkeypatch.setattr(WorkspaceService, "resolve_workspace", observe)
    async with session_factory() as db:
        await db.scalar(select(Workspace.id).where(Workspace.id == UUID(c["ws"])).with_for_update())
        pending = asyncio.create_task(change(c, action, 2 if action == "restore" else 1))
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
        assert row.status == ("deleted" if action == "restore" else "active")
        assert row.version == (2 if action == "restore" else 1)


@pytest.mark.parametrize("action", ["delete", "restore"])
async def test_deletion_ledger_failure_rolls_back(online_case, monkeypatch, action):
    c = online_case
    if action == "restore":
        assert (await change(c)).status_code == 200

    async def fail(*_args, **_kwargs):
        raise RuntimeError("synthetic lifecycle ledger failure")

    monkeypatch.setattr(SyncLedgerService, "append_applied", fail)
    with pytest.raises(RuntimeError, match="synthetic lifecycle ledger failure"):
        await change(c, action, 2 if action == "restore" else 1)
    async with session_factory() as db:
        row = await db.get(Space, UUID(c["sp"]))
        assert row.status == ("deleted" if action == "restore" else "active")
        assert row.version == (2 if action == "restore" else 1)
        assert (row.deleted_at is not None) == (action == "restore")
