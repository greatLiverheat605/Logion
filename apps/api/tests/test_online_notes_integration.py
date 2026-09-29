import asyncio
import base64
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Note, Resource
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuditEvent, User
from logion_api.main import app
from logion_api.sync.models import SyncChange
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from pycrdt import Doc, Text
from sqlalchemy import func, select
from test_online_planning_integration import online_case as online_case
from test_online_planning_integration import pull

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def path(c):
    return c["path"].replace("/goals", "/notes")


async def create(c):
    result = await c["client"].post(
        path(c), headers=c["csrf"], json={"id": str(uuid4()), "title": "Online note"}
    )
    assert result.status_code == 201, result.text
    return result.json()


def edit(c, note, text):
    doc = Doc({"markdown": Text()})
    doc.apply_update(base64.b64decode(note["yjs_state_base64"]))
    vector = doc.get_state()
    doc["markdown"].insert(0, text)
    return {
        "space_id": c["sp"],
        "base_version": note["version"],
        "yjs_generation": note["yjs_generation"],
        "update_base64": base64.b64encode(doc.get_update(vector)).decode(),
    }


async def test_online_notes_merge_and_reach_existing_sync_cursor(online_case):
    c = online_case
    note = await create(c)
    assert note["can_edit"] and note["note_kind"] is None
    created = await pull(c)
    assert {r["entity_type"] for r in created} == {"note", "note_document_state"}
    for content in ["Left ", "Right "]:
        r = await c["client"].patch(
            f"{path(c)}/{note['id']}/document", headers=c["csrf"], json=edit(c, note, content)
        )
        assert r.status_code == 200, r.text
    merged = r.json()
    assert "Left " in merged["markdown_body"] and "Right " in merged["markdown_body"]
    assert merged["version"] == 3 and merged["yjs_generation"] == 1
    changes = await pull(c)
    assert len(changes) == 6
    state = next(r for r in reversed(changes) if r["entity_type"] == "note_document_state")
    restored = Doc({"markdown": Text()})
    restored.apply_update(base64.b64decode(state["payload"]["state_base64"]))
    assert str(restored["markdown"]) == merged["markdown_body"]
    renamed = await c["client"].patch(
        f"{path(c)}/{note['id']}",
        headers=c["csrf"],
        json={"expected_version": 3, "title": "Changed title"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["yjs_state_base64"] == merged["yjs_state_base64"]
    assert renamed.json()["yjs_generation"] == 1
    changes = await pull(c)
    assert len(changes) == 2 and changes[0]["payload"]["title"] == "Changed title"
    assert changes[0]["payload"]["markdown_body"] == merged["markdown_body"]


async def test_existing_note_edit_validation_and_no_read_side_effects(online_case):
    c = online_case
    legacy_id = str(uuid4())
    r = await c["client"].post(
        path(c).replace("/research", ""),
        headers=c["csrf"],
        json={"id": legacy_id, "title": "Existing old note", "markdown_body": "Existing body"},
    )
    assert r.status_code == 201, r.text
    listed = await c["client"].get(path(c), params={"limit": 1})
    assert listed.status_code == 200 and listed.json()["notes"][0]["id"] == legacy_id
    assert "markdown_body" not in listed.text and "yjs_state" not in listed.text
    note = (await c["client"].get(f"{path(c)}/{legacy_id}")).json()
    assert note["markdown_body"] == "Existing body"
    assert await pull(c) == []
    url = f"{path(c)}/{legacy_id}/document"
    update = edit(c, note, "Preserved ")
    for payload, headers, status in [
        (update, {}, 403),
        (update, {**c["csrf"], "Origin": "http://untrusted.invalid"}, 403),
        ({**update, "base_version": 99}, c["csrf"], 409),
        ({**update, "yjs_generation": 2}, c["csrf"], 409),
        ({**update, "space_id": str(uuid4())}, c["csrf"], 404),
        ({**update, "update_base64": "!!!!"}, c["csrf"], 422),
        ({**update, "update_base64": "eA=="}, c["csrf"], 422),
    ]:
        result = await c["client"].patch(url, headers=headers, json=payload)
        assert result.status_code == status, result.text
    assert (
        await c["client"].patch(
            f"{path(c)}/{legacy_id}",
            headers=c["csrf"],
            json={"expected_version": 1, "title": "x" * 201},
        )
    ).status_code == 422
    assert (await c["client"].get(path(c).replace(c["sp"], str(uuid4())))).status_code == 404
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(path(c))).status_code == 404
    c["flags"]["research_v3_enabled"] = True
    result = await c["client"].patch(url, headers=c["csrf"], json=update)
    assert result.status_code == 200 and result.json()["markdown_body"] == "Preserved Existing body"
    conflict = await c["client"].patch(
        f"{path(c)}/{legacy_id}", headers=c["csrf"], json={"expected_version": 1, "title": "Stale"}
    )
    assert conflict.status_code == 409
    assert len(await pull(c)) == 3


async def test_online_note_ledger_failure_rolls_back_content_and_audit(online_case, monkeypatch):
    c = online_case
    note = await create(c)
    await pull(c)
    original = SyncLedgerService.append_applied
    calls = 0

    async def fail(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic ledger failure")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(SyncLedgerService, "append_applied", fail)
    with pytest.raises(RuntimeError, match="synthetic ledger failure"):
        await c["client"].patch(
            f"{path(c)}/{note['id']}/document",
            headers=c["csrf"],
            json=edit(c, note, "Must roll back"),
        )
    async with session_factory() as db:
        row = await db.get(Note, UUID(note["id"]))
        assert row.version == 1 and row.markdown_body == ""
        assert (
            await db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(
                    AuditEvent.target_id == row.id,
                    AuditEvent.event_type == "content.note_document_updated",
                )
            )
            == 0
        )
    assert await pull(c) == []


async def test_shared_notes_private_reading_isolation_and_source_unavailability(online_case):
    c = online_case
    ordinary = await create(c)
    library = path(c).replace("/research/notes", "/library/resources")
    resource = await c["client"].post(
        library,
        headers=c["csrf"],
        json={"title": "PRIVATE_READING_SENTINEL", "resource_type": "paper"},
    )
    assert resource.status_code == 201, resource.text
    resource_id = resource.json()["id"]
    reading = await c["client"].post(f"{library}/{resource_id}/note", headers=c["csrf"])
    assert reading.status_code == 200, reading.text
    reading_id = reading.json()["id"]
    items = (await c["client"].get(path(c), params={"limit": 1})).json()
    next_page = (
        await c["client"].get(path(c), params={"cursor": items["next_cursor"], "limit": 1})
    ).json()
    assert {n["id"] for n in items["notes"] + next_page["notes"]} == {ordinary["id"], reading_id}
    assert next_page["next_cursor"] is None
    private_detail = (await c["client"].get(f"{path(c)}/{reading_id}")).json()
    assert private_detail["source_available"] and not private_detail["can_edit"]
    for suffix, body in [
        ("", {"expected_version": 1, "title": "Denied"}),
        ("/document", edit(c, private_detail, "Denied")),
    ]:
        result = await c["client"].patch(
            f"{path(c)}/{reading_id}{suffix}", headers=c["csrf"], json=body
        )
        assert result.status_code == 404, result.text
    uid = uuid4().hex
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(f"2001:db8::{uid[:4]}:{uid[4:8]}", 51003)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        email = f"note-viewer-{uid}@example.com"
        r = await other.post(
            "/api/v1/auth/register",
            json={"email": email, "password": f"synthetic-{uuid4()}", "device_name": "Viewer"},
        )
        assert r.status_code == 201, r.text
        assert (await other.get(path(c))).status_code == 404
        async with session_factory() as db:
            viewer = await db.scalar(select(User).where(User.email == email))
            space = await db.get(Space, UUID(c["sp"]))
            space.visibility, space.owner_user_id = "shared", None
            member = WorkspaceMembership(
                workspace_id=space.workspace_id,
                user_id=viewer.id,
                role="viewer",
                status="active",
                joined_at=utc_now(),
            )
            db.add(member)
            await db.commit()
            member_id = member.id
        listed = await other.get(path(c))
        assert listed.status_code == 200 and not listed.json()["can_create"]
        assert [n["id"] for n in listed.json()["notes"]] == [ordinary["id"]]
        assert "PRIVATE_READING_SENTINEL" not in listed.text
        assert (await other.get(f"{path(c)}/{reading_id}")).status_code == 404
        csrf = {"X-CSRF-Token": other.cookies["logion_csrf"]}
        url = f"{path(c)}/{ordinary['id']}"
        assert not (await other.get(url)).json()["can_edit"]
        assert (
            await other.patch(url, headers=csrf, json={"expected_version": 1, "title": "Denied"})
        ).status_code == 403
        async with session_factory() as db:
            member = await db.get(WorkspaceMembership, member_id)
            member.role = "editor"
            source = await db.get(Resource, UUID(resource_id))
            source.deleted_at = utc_now()
            await db.commit()
        assert (
            await other.patch(
                url, headers=csrf, json={"expected_version": 1, "title": "Editor update"}
            )
        ).status_code == 200
    detail = (await c["client"].get(f"{path(c)}/{reading_id}")).json()
    assert (
        not detail["source_available"]
        and detail["markdown_body"] == reading.json()["markdown_body"]
    )
    assert all("PRIVATE_READING_SENTINEL" not in str(change) for change in await pull(c))


async def test_note_rechecks_membership_after_lock_wait(online_case, monkeypatch):
    c = online_case
    note = await create(c)
    authorized = asyncio.Event()
    original = WorkspaceService.resolve_space

    async def observe(self, *args, **kwargs):
        result = await original(self, *args, **kwargs)
        authorized.set()
        return result

    monkeypatch.setattr(WorkspaceService, "resolve_space", observe)
    async with session_factory() as db:
        await db.scalar(select(Workspace.id).where(Workspace.id == UUID(c["ws"])).with_for_update())
        pending = asyncio.create_task(
            c["client"].patch(
                f"{path(c)}/{note['id']}",
                headers=c["csrf"],
                json={"expected_version": 1, "title": "Revoked"},
            )
        )
        try:
            await asyncio.wait_for(authorized.wait(), timeout=5)
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
        row = await db.get(Note, UUID(note["id"]))
        assert row.version == 1
        assert (
            await db.scalar(
                select(func.count())
                .select_from(SyncChange)
                .where(SyncChange.workspace_id == UUID(c["ws"]))
            )
            == 2
        )
