import asyncio
import io
import json
import zipfile
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from logion_api.config import get_settings
from logion_api.db import session_factory, utc_now
from logion_api.form_drafts import service
from logion_api.form_drafts.models import FormDraft
from logion_api.identity.models import AuditEvent
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.research.models import ResearchIdea
from logion_api.workspaces.models import Space, WorkspaceMembership
from sqlalchemy import func, select
from test_weekly_reviews import weekly_scope as weekly_scope

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]
SENTINEL = "PRIVATE_UNSUBMITTED_FORM_SENTINEL"
NEW = str(UUID(int=0))


def path(scope, kind="idea_create", target=NEW):
    return f"{scope}/research/form-drafts/{kind}/{target}"


async def save(browser, url, version=0, text=SENTINEL):
    result = await browser.put(url, json={"expected_version": version, "fields": {"body": text}})
    assert result.status_code == 200, result.text
    return result.json()["draft"]


async def test_private_draft_cas_validation_and_atomic_submission(weekly_scope):
    owner, peer, scope, _workspace, users, _goal, _resource = weekly_scope
    url = path(scope)
    draft = await save(owner, url)
    assert (await owner.get(url)).json()["draft"] == draft
    assert (await peer.get(url)).json() == {"draft": None}
    for fields in ({"password": SENTINEL}, {"body": "\x00"}, {"body": "x" * 100001}, {"body": 1}):
        denied = await owner.put(url, json={"expected_version": 1, "fields": fields})
        assert denied.status_code == 422, denied.text
        assert SENTINEL not in denied.text
    for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.example.com"}):
        denied = await owner.put(
            url, headers=headers, json={"expected_version": 1, "fields": {"body": SENTINEL}}
        )
        assert denied.status_code == 403
    results = await asyncio.gather(
        *[
            owner.put(
                url,
                json={"expected_version": 1, "expected_id": draft["id"], "fields": {"body": text}},
            )
            for text in (SENTINEL + " first", SENTINEL + " second")
        ]
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    current = (await owner.get(url)).json()["draft"]
    assert current["version"] == 2
    reference = {"X-Logion-Form-Draft": f"{current['id']}:{current['version']}"}
    denied = await peer.post(
        scope + "/research/ideas", headers=reference, json={"title": "Forged", "body": ""}
    )
    assert denied.status_code == 409 and SENTINEL not in denied.text
    failed = await owner.post(
        scope + "/research/ideas", headers=reference, json={"title": "", "body": SENTINEL}
    )
    assert failed.status_code == 422
    assert (await owner.get(url)).json()["draft"] == current
    created = await owner.post(
        scope + "/research/ideas",
        headers=reference,
        json={"title": "Synthetic idea", "body": current["fields"]["body"]},
    )
    assert created.status_code == 201, created.text
    assert (await owner.get(url)).json() == {"draft": None}
    late = await owner.put(url, json={"expected_version": 2, "fields": {"body": "late"}})
    assert late.status_code == 409
    async with session_factory() as db:
        assert (
            await db.scalar(select(func.count(FormDraft.id)).where(FormDraft.user_id == users[0]))
            == 0
        )
        assert await db.get(ResearchIdea, UUID(created.json()["id"])) is not None
        audits = list(
            await db.scalars(
                select(AuditEvent).where(
                    AuditEvent.actor_id == users[0], AuditEvent.event_type.like("form_draft.%")
                )
            )
        )
        assert audits and all(row.event_metadata == {"form_kind": "idea_create"} for row in audits)
        assert SENTINEL not in json.dumps([row.event_metadata for row in audits])


async def test_draft_expiry_discard_and_target_access(weekly_scope, monkeypatch):
    owner, peer, scope, _workspace, users, _goal, resource = weekly_scope
    url = path(scope)
    draft = await save(owner, url)
    now = utc_now()
    async with session_factory() as db:
        row = await db.get(FormDraft, UUID(draft["id"]))
        assert row is not None and row.expires_at - row.updated_at == timedelta(days=7)
        row.expires_at = now
        await db.commit()
    monkeypatch.setattr(service, "utc_now", lambda: now)
    assert (await owner.get(url)).json() == {"draft": None}
    assert await service.cleanup_expired()
    async with session_factory() as db:
        assert await db.get(FormDraft, UUID(draft["id"])) is None
    fresh = await save(owner, url)
    stale = await owner.delete(url, params={"expected_version": 2, "expected_id": fresh["id"]})
    assert stale.status_code == 409
    assert (
        await owner.delete(
            url, params={"expected_version": fresh["version"], "expected_id": fresh["id"]}
        )
    ).status_code == 204
    replacement = await save(owner, url)
    assert replacement["id"] != fresh["id"] and replacement["version"] == fresh["version"]
    stale_save = await owner.put(
        url,
        json={
            "expected_version": fresh["version"],
            "expected_id": fresh["id"],
            "fields": {"body": "old tab"},
        },
    )
    assert stale_save.status_code == 409
    assert (
        await owner.delete(
            url, params={"expected_version": fresh["version"], "expected_id": fresh["id"]}
        )
    ).status_code == 409
    assert (await owner.get(url)).json()["draft"] == replacement
    source_url = path(scope, "source_edit", resource["id"])
    saved = await owner.put(
        source_url, json={"expected_version": 0, "fields": {"abstract": SENTINEL}}
    )
    assert saved.status_code == 200, saved.text
    denied = await peer.get(source_url)
    assert denied.status_code == 404 and SENTINEL not in denied.text
    deleted = await owner.request(
        "DELETE",
        scope + f"/library/resources/{resource['id']}",
        json={"expected_version": resource["version"]},
    )
    assert deleted.status_code == 204, deleted.text
    denied = await owner.get(source_url)
    assert denied.status_code == 404 and SENTINEL not in denied.text


@pytest.mark.parametrize("state", ["archived", "deleted", "revoked"])
async def test_drafts_hide_after_space_or_membership_access_ends(weekly_scope, state):
    owner, _peer, scope, workspace, users, _goal, _resource = weekly_scope
    url = path(scope)
    await save(owner, url)
    async with session_factory() as db:
        if state == "revoked":
            row = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == UUID(workspace),
                    WorkspaceMembership.user_id == users[0],
                )
            )
            row.status = "revoked"
        else:
            row = await db.get(Space, UUID(scope.rsplit("/", 1)[-1]))
            if state == "archived":
                row.status = "archived"
            else:
                row.deleted_at = utc_now()
        await db.commit()
    for response in [
        await owner.get(url),
        await owner.put(url, json={"expected_version": 1, "fields": {"body": SENTINEL}}),
    ]:
        assert response.status_code in (403, 404), response.text
        assert SENTINEL not in response.text


async def test_logout_removes_only_owner_drafts_and_rejects_late_autosave(
    weekly_scope, monkeypatch
):
    owner, peer, scope, _workspace, users, _goal, _resource = weekly_scope
    url = path(scope)
    await save(owner, url)
    await save(peer, url, text="Peer private draft")
    entered, resume = asyncio.Event(), asyncio.Event()
    original = service.lock_user

    async def delayed_lock(db, context):
        if context.user.id == users[0]:
            entered.set()
            await resume.wait()
        await original(db, context)

    monkeypatch.setattr(service, "lock_user", delayed_lock)
    pending = asyncio.create_task(
        owner.put(url, json={"expected_version": 1, "fields": {"body": SENTINEL + " late"}})
    )
    try:
        await asyncio.wait_for(entered.wait(), 10)
        logged_out = await owner.post("/api/v1/auth/logout")
        assert logged_out.status_code == 200, logged_out.text
    finally:
        resume.set()
    assert (await pending).status_code == 401
    assert (await peer.get(url)).json()["draft"]["fields"] == {"body": "Peer private draft"}
    async with session_factory() as db:
        assert (
            await db.scalar(select(func.count(FormDraft.id)).where(FormDraft.user_id == users[0]))
            == 0
        )


async def test_draft_quota_expiry_and_submission_target_binding(weekly_scope):
    owner, _peer, scope, _workspace, _users, _goal, _resource = weekly_scope
    drafts = []
    ideas = []
    for index in range(20):
        created = await owner.post(
            scope + "/research/ideas", json={"title": f"Synthetic {index}", "body": ""}
        )
        assert created.status_code == 201
        idea = created.json()
        ideas.append(idea)
        drafts.append(await save(owner, path(scope, "idea_edit", idea["id"])))
    full = await owner.put(path(scope), json={"expected_version": 0, "fields": {"body": SENTINEL}})
    assert full.status_code == 409 and full.json()["code"] == "FORM_DRAFT_QUOTA"
    first = drafts[0]
    wrong = await owner.put(
        scope + f"/research/ideas/{ideas[1]['id']}",
        headers={"X-Logion-Form-Draft": f"{first['id']}:1"},
        json={"title": "Wrong target", "body": "", "status": "active", "expected_version": 1},
    )
    assert wrong.status_code == 409
    assert (await owner.get(path(scope, "idea_edit", ideas[0]["id"]))).json()["draft"] == first
    async with session_factory() as db:
        row = await db.get(FormDraft, UUID(first["id"]))
        row.expires_at = utc_now() - timedelta(seconds=1)
        await db.commit()
    assert (await save(owner, path(scope)))["fields"]["body"] == SENTINEL


async def test_drafts_never_enter_search_sync_exports_ai_or_agent_reads(weekly_scope, monkeypatch):
    import httpx
    from logion_api.main import app

    owner, peer, scope, workspace, users, _goal, _resource = weekly_scope
    draft = await save(owner, path(scope))
    for client in (owner, peer):
        search = await client.post(
            f"/api/v1/workspaces/{workspace}/search", json={"query": SENTINEL}
        )
        assert search.status_code == 200 and SENTINEL not in search.text
        devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
        device = next(item["id"] for item in devices if item["current"])
        sync = f"/api/v1/workspaces/{workspace}/sync"
        boot = await client.post(
            sync + "/bootstrap",
            json={
                "message_type": "bootstrap_request",
                "protocol_version": "sync-v1",
                "workspace_id": workspace,
                "device_id": device,
                "known_sync_epoch": None,
                "snapshot_id": None,
                "chunk_index": None,
            },
        )
        assert boot.status_code == 200, boot.text
        assert SENTINEL not in boot.text and draft["id"] not in boot.text
        pull = await client.post(
            sync + "/pull",
            json={
                "message_type": "pull_request",
                "protocol_version": "sync-v1",
                "workspace_id": workspace,
                "device_id": device,
                "sync_epoch": boot.json()["sync_epoch"],
                "cursor": 0,
                "limit": 100,
            },
        )
        assert pull.status_code == 200, pull.text
        assert SENTINEL not in pull.text and draft["id"] not in pull.text
        denied = await client.post(
            scope + "/research/ai/runs",
            json={
                "id": str(uuid4()),
                "idempotency_key": str(uuid4()),
                "task_type": "explain",
                "target": {"entity_type": "form_draft", "id": draft["id"], "version": 1},
                "expected_output_fields": ["text"],
                "send_confirmed": True,
            },
        )
        assert denied.status_code in (403, 422), denied.text
        assert SENTINEL not in denied.text
    async with session_factory() as db:
        exports = object.__new__(PortabilityService)
        for user in users:
            archive = await exports._build_archive(
                db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
            )
            with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                for name in bundle.namelist():
                    assert SENTINEL.encode() not in bundle.read(name)
    monkeypatch.setattr(get_settings(), "agent_api_enabled", True)
    issued = await owner.post(
        "/api/v1/research/agent-tokens",
        json={
            "workspace_id": workspace,
            "space_id": scope.rsplit("/", 1)[-1],
            "name": "Synthetic drafts privacy",
            "scopes": ["read"],
            "expires_at": (utc_now() + timedelta(days=1)).isoformat(),
        },
    )
    assert issued.status_code == 201, issued.text
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer " + issued.json()["token"]},
    ) as agent:
        for suffix in ("/resources", "/entities/research_question", "/entities/topic"):
            result = await agent.get("/api/v1/agent" + suffix)
            assert result.status_code == 200, result.text
            assert SENTINEL not in result.text and draft["id"] not in result.text
        blocked = await agent.get(path(scope))
        assert blocked.status_code == 403 and blocked.json()["code"] == "AGENT_ENDPOINT_FORBIDDEN"
        denied = await agent.get(f"/api/v1/agent/entities/form_draft/{draft['id']}")
        assert denied.status_code == 403 and SENTINEL not in denied.text
