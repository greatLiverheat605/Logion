import asyncio
import base64
from datetime import timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.agents import inbox
from logion_api.agents.models import AgentInboxItem, AgentToken
from logion_api.agents.schemas import AgentDecision, AgentSubmission, AgentTokenCreate
from logion_api.agents.security import digest
from logion_api.config import Settings, get_settings
from logion_api.content.models import Note
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuditEvent, AuthSession
from logion_api.main import app
from logion_api.research.models import ResearchIdea
from logion_api.sync.models import SyncChange
from logion_api.workspaces.models import Space, WorkspaceMembership
from pycrdt import Doc, Text
from pydantic import ValidationError
from sqlalchemy import func, select, update
from test_online_planning_integration import online_case as online_case


def test_agent_config_and_strict_payloads():
    assert not Settings(_env_file=None).agent_api_enabled
    valid = AgentSubmission.model_validate(
        {
            "submission_key": "synthetic-1",
            "payload": {
                "kind": "source",
                "title": "Synthetic",
                "doi": "https://doi.org/10.1234/EXAMPLE",
            },
        }
    )
    assert valid.payload.doi == "10.1234/example"
    for body in [
        {"kind": "idea", "title": "private"},
        {
            "kind": "source",
            "title": "Synthetic",
            "file_locator": {"kind": "url", "path": "https://example.com"},
        },
        {"kind": "source", "title": "Synthetic", "source_url": "javascript:alert(1)"},
        {"kind": "source", "title": "bad\x00"},
        {"kind": "report", "title": "Synthetic", "markdown_body": "文" * 24000},
        {
            "kind": "edge",
            "from_type": "idea",
            "from_id": str(uuid4()),
            "to_type": "resource",
            "to_id": str(uuid4()),
            "relation": "inspired_by",
        },
    ]:
        with pytest.raises(ValidationError):
            AgentSubmission.model_validate({"submission_key": "same", "payload": body})
    with pytest.raises(ValidationError):
        AgentDecision(
            expected_version=1, decision="discarded", payload={"kind": "source", "title": "ignored"}
        )
    with pytest.raises(ValidationError):
        AgentTokenCreate(
            workspace_id=uuid4(),
            space_id=uuid4(),
            name="synthetic",
            scopes=["read", "read"],
            expires_at=utc_now() + timedelta(days=1),
        )


@pytest_asyncio.fixture(loop_scope="session")
async def agent_case(online_case, monkeypatch):
    c = online_case
    monkeypatch.setattr(get_settings(), "research_v3_enabled", True)
    monkeypatch.setattr(get_settings(), "agent_api_enabled", True)
    c["agent_path"] = f"/api/v1/workspaces/{c['ws']}/spaces/{c['sp']}/agent-inbox"
    c["library"] = f"/api/v1/workspaces/{c['ws']}/spaces/{c['sp']}/library/resources"
    issued = await issue(c)
    c["issued"] = issued
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("2001:db8::a", 51222)),
        base_url="http://test",
        headers={"Authorization": "Bearer " + issued["token"]},
    ) as agent:
        c["agent"] = agent
        yield c


async def issue(c, scopes=None):
    response = await c["client"].post(
        "/api/v1/research/agent-tokens",
        headers=c["csrf"],
        json={
            "workspace_id": c["ws"],
            "space_id": c["sp"],
            "name": "Synthetic local agent",
            "scopes": scopes or ["read", "inbox:write"],
            "expires_at": (utc_now() + timedelta(days=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    assert response.headers["cache-control"] == "private, no-store"
    return response.json()


async def submit(c, payload=None, key=None):
    response = await c["agent"].post(
        "/api/v1/agent/inbox",
        json={
            "submission_key": key or str(uuid4()),
            "payload": payload or {"kind": "source", "title": "Synthetic from agent"},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def decide(c, item, *, payload=None, decision="accepted"):
    response = await c["client"].post(
        f"{c['agent_path']}/{item['id']}/decision",
        headers=c["csrf"],
        json={
            "expected_version": 1,
            "decision": decision,
            **({"payload": payload} if payload else {}),
        },
    )
    return response


integration = [pytest.mark.integration, pytest.mark.asyncio]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pat_hash_scopes_and_cookie_isolation(agent_case):
    c = agent_case
    listed = await c["client"].get("/api/v1/research/agent-tokens")
    assert listed.status_code == 200
    assert c["issued"]["token"] not in listed.text and "digest" not in listed.text
    async with session_factory() as db:
        token = await db.get(AgentToken, UUID(c["issued"]["detail"]["id"]))
        assert token.token_digest == digest(c["issued"]["token"])
        assert len(token.token_digest) == 64
    assert (await c["agent"].get("/api/v1/agent/resources")).status_code == 200
    # Even valid cookies cannot upgrade a PAT to the owner's session authority.
    c["agent"].cookies.update(c["client"].cookies)
    for path in [
        "/api/v1/auth/me",
        "/api/v1/research/agent-tokens",
        "/api/v1/research/integrations/zotero",
        c["agent_path"],
        c["library"],
        c["library"].replace("/library/resources", "/research/ideas"),
    ]:
        response = await c["agent"].get(path)
        assert response.status_code == 403, (path, response.text)
    for malformed in [
        "Bearer  " + c["issued"]["token"],
        "Bearer\t" + c["issued"]["token"],
        "Basic " + c["issued"]["token"],
        "Bearer " + c["issued"]["token"] + " extra",
    ]:
        assert (
            await c["agent"].get("/api/v1/auth/me", headers={"Authorization": malformed})
        ).status_code == 401
    assert (
        await c["agent"].get(
            "/api/v1/auth/me",
            headers=[
                ("Authorization", "Bearer unrelated"),
                ("Authorization", "Bearer " + c["issued"]["token"]),
            ],
        )
    ).status_code == 401
    readonly = await issue(c, ["read"])
    blocked = await c["agent"].post(
        "/api/v1/agent/inbox",
        headers={"Authorization": "Bearer " + readonly["token"]},
        json={"submission_key": "blocked", "payload": {"kind": "source", "title": "Never written"}},
    )
    assert blocked.status_code == 403
    writeonly = await issue(c, ["inbox:write"])
    assert (
        await c["agent"].get(
            "/api/v1/agent/resources", headers={"Authorization": "Bearer " + writeonly["token"]}
        )
    ).status_code == 403
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test", cookies=c["client"].cookies
    ) as cookie_only:
        assert (await cookie_only.get("/api/v1/agent/resources")).status_code == 401


@pytest.mark.integration
@pytest.mark.asyncio
async def test_inbox_submit_edit_accept_is_atomic_and_idempotent(agent_case):
    c = agent_case
    proposal = {"kind": "source", "title": "Original proposal", "doi": "10.1234/" + uuid4().hex}
    body = {"submission_key": "concurrent", "payload": proposal}
    responses = await asyncio.gather(
        *(c["agent"].post("/api/v1/agent/inbox", json=body) for _ in range(2))
    )
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses]
    item = responses[0].json()
    assert item == responses[1].json()
    assert (await c["client"].get(c["library"])).json()["resources"] == []
    conflict = await c["agent"].post(
        "/api/v1/agent/inbox", json={**body, "payload": {**proposal, "title": "Different"}}
    )
    assert conflict.status_code == 409
    edited = {**proposal, "title": "Owner edited title"}
    accepted = await asyncio.gather(*(decide(c, item, payload=edited) for _ in range(2)))
    assert all(r.status_code == 200 for r in accepted), [r.text for r in accepted]
    assert accepted[0].json() == accepted[1].json()
    row = accepted[0].json()
    assert row["payload"]["title"] == proposal["title"]
    assert row["accepted_payload"]["title"] == edited["title"]
    assert row["version"] == 2 and row["status"] == "accepted"
    resources = (await c["client"].get(c["library"])).json()["resources"]
    assert len(resources) == 1 and resources[0]["title"] == edited["title"]
    other = await submit(c, proposal)
    assert (await decide(c, other)).status_code == 409
    assert (await decide(c, item, decision="discarded")).status_code == 409
    assert len((await c["client"].get(c["agent_path"])).json()["items"]) == 1
    c["agent"].cookies.update(c["client"].cookies)
    assert (
        await c["agent"].post(
            f"{c['agent_path']}/{other['id']}/decision",
            headers=c["csrf"],
            json={"expected_version": 1, "decision": "accepted"},
        )
    ).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_accept_failure_rolls_back_formal_data_and_receipt(agent_case, monkeypatch):
    c = agent_case
    item = await submit(c)

    def fail(*_args):
        raise RuntimeError("synthetic atomicity failure")

    monkeypatch.setattr(inbox, "audit", fail)
    with pytest.raises(RuntimeError, match="synthetic atomicity"):
        await decide(c, item)
    assert (await c["client"].get(c["library"])).json()["resources"] == []
    async with session_factory() as db:
        row = await db.get(AgentInboxItem, UUID(item["id"]))
        assert row.status == "pending" and row.receipt is None and row.version == 1


@pytest.mark.integration
@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["report", "summary"])
async def test_reports_are_private_yjs_notes_without_sync_writes(agent_case, kind):
    c = agent_case
    body = "Synthetic accepted report"
    item = await submit(c, {"kind": kind, "title": "Synthetic note", "markdown_body": body})
    accepted = await decide(c, item)
    assert accepted.status_code == 200, accepted.text
    identity = accepted.json()["receipt"]["id"]
    path = f"{c['agent_path']}/notes/{identity}"
    note = (await c["client"].get(path)).json()
    assert note["markdown_body"] == body and note["can_edit"]
    doc = Doc({"markdown": Text()})
    doc.apply_update(base64.b64decode(note["yjs_state_base64"]))
    vector = doc.get_state()
    doc["markdown"].insert(0, "Edited ")
    edited = await c["client"].patch(
        path + "/document",
        headers=c["csrf"],
        json={
            "space_id": c["sp"],
            "base_version": 1,
            "yjs_generation": 1,
            "update_base64": base64.b64encode(doc.get_update(vector)).decode(),
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["markdown_body"] == "Edited " + body
    records = (
        await c["client"].get(c["library"].replace("/library/resources", "/research/notes"))
    ).json()
    assert identity in [n["id"] for n in records["notes"]]
    read = await c["agent"].get(f"/api/v1/agent/entities/note/{identity}")
    assert read.status_code == 200 and read.json()["data"]["markdown_body"] == "Edited " + body
    async with session_factory() as db:
        row = await db.get(Note, UUID(identity))
        assert (
            row.research_owner_id is not None
            and row.note_kind is None
            and row.agent_inbox_item_id == UUID(item["id"])
        )
        assert (
            await db.scalar(
                select(func.count()).select_from(SyncChange).where(SyncChange.entity_id == row.id)
            )
            == 0
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_revoked_expired_and_removed_membership_fail_closed(agent_case):
    c = agent_case
    result = await c["client"].post(
        f"/api/v1/research/agent-tokens/{c['issued']['detail']['id']}/revoke", headers=c["csrf"]
    )
    assert result.status_code == 200
    assert (await c["agent"].get("/api/v1/agent/resources")).status_code == 401
    issued = await issue(c)
    c["agent"].headers["Authorization"] = "Bearer " + issued["token"]
    async with session_factory() as db:
        await db.execute(
            update(AgentToken)
            .where(AgentToken.id == UUID(issued["detail"]["id"]))
            .values(
                created_at=utc_now() - timedelta(days=2), expires_at=utc_now() - timedelta(days=1)
            )
        )
        await db.commit()
    assert (await c["agent"].get("/api/v1/agent/resources")).status_code == 401
    issued = await issue(c)
    c["agent"].headers["Authorization"] = "Bearer " + issued["token"]
    async with session_factory() as db:
        await db.execute(
            update(WorkspaceMembership)
            .where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
            .values(status="revoked")
        )
        await db.commit()
    assert (await c["agent"].get("/api/v1/agent/resources")).status_code == 403


@pytest.mark.integration
@pytest.mark.asyncio
async def test_ideas_and_private_fields_never_enter_agent_output(agent_case):
    c = agent_case
    sentinel = "NEVER-AGENT-IDEA-" + uuid4().hex
    async with session_factory() as db:
        token = await db.get(AgentToken, UUID(c["issued"]["detail"]["id"]))
        idea = ResearchIdea(
            workspace_id=token.workspace_id,
            space_id=token.space_id,
            user_id=token.user_id,
            title=sentinel,
            body=sentinel,
            created_by=token.user_id,
            updated_by=token.user_id,
        )
        db.add(idea)
        await db.commit()
        identity = idea.id
    for kind in ["idea", "research_idea", "research_ideas", "credentials", "knowledge_edge"]:
        r = await c["agent"].get(f"/api/v1/agent/entities/{kind}/{identity}")
        assert r.status_code == 403 and sentinel not in r.text
    item = await submit(c)
    resource = (await decide(c, item)).json()["receipt"]["id"]
    for path in [
        "/api/v1/agent/resources",
        f"/api/v1/agent/entities/resource/{resource}",
        "/api/v1/agent/entities/research_question",
        "/api/v1/agent/entities/topic",
    ]:
        r = await c["agent"].get(path)
        assert r.status_code == 200, r.text
        assert not any(
            secret in r.text
            for secret in [sentinel, "file_locator", "zotero", "research_owner_id", "token_digest"]
        )
    async with session_factory() as db:
        audits = list(
            await db.scalars(
                select(AuditEvent).where(AuditEvent.target_id == UUID(c["issued"]["detail"]["id"]))
            )
        )
        assert any(a.result == "denied" for a in audits)
        assert any(a.result == "success" for a in audits)
        assert all(
            sentinel not in str(a.event_metadata)
            and c["issued"]["token"] not in str(a.event_metadata)
            for a in audits
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_management_requires_origin_csrf_and_recent_auth(agent_case):
    c = agent_case
    route = f"/api/v1/research/agent-tokens/{c['issued']['detail']['id']}/revoke"
    assert (await c["client"].post(route)).status_code == 403
    assert (
        await c["client"].post(
            route, headers={**c["csrf"], "Origin": "https://untrusted.example.com"}
        )
    ).status_code == 403
    async with session_factory() as db:
        token = await db.get(AgentToken, UUID(c["issued"]["detail"]["id"]))
        await db.execute(
            update(AuthSession)
            .where(AuthSession.user_id == token.user_id)
            .values(created_at=utc_now() - timedelta(hours=1))
        )
        await db.commit()
    result = await c["client"].post(route, headers=c["csrf"])
    assert result.status_code == 403, result.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agent_flags_disable_all_new_paths(agent_case, monkeypatch):
    c = agent_case
    monkeypatch.setattr(get_settings(), "agent_api_enabled", False)
    for client, path in [
        (c["agent"], "/api/v1/agent/resources"),
        (c["client"], "/api/v1/research/agent-tokens"),
        (c["client"], c["agent_path"]),
    ]:
        assert (await client.get(path)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agent_shared_space_isolation(agent_case):
    c = agent_case
    item = await submit(
        c,
        {
            "kind": "report",
            "title": "Owner private note",
            "markdown_body": "PRIVATE-REPORT-SENTINEL",
        },
    )
    note = (await decide(c, item)).json()["receipt"]["id"]
    source_item = await submit(c)
    source = (await decide(c, source_item)).json()["receipt"]["id"]
    async with AsyncClient(
        transport=ASGITransport(app=app, client=("2001:db8::bbbb", 52221)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        register = await other.post(
            "/api/v1/auth/register",
            json={
                "email": f"agent-peer-{uuid4()}@example.com",
                "password": "synthetic-peer-987654321",
                "device_name": "Synthetic peer",
            },
        )
        assert register.status_code == 201, register.text
        user = UUID(register.json()["user"]["id"])
        async with session_factory() as db:
            await db.execute(
                update(Space).where(Space.id == UUID(c["sp"])).values(visibility="shared")
            )
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(c["ws"]),
                    user_id=user,
                    role="editor",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            await db.commit()
        peer = {**c, "client": other, "csrf": {"X-CSRF-Token": other.cookies["logion_csrf"]}}
        issued = await issue(peer)
        headers = {"Authorization": "Bearer " + issued["token"]}
        assert (await other.get(c["agent_path"], params={"status": "accepted"})).json()[
            "items"
        ] == []
        assert (await other.get(f"{c['agent_path']}/notes/{note}")).status_code == 404
        assert (await decide(peer, item)).status_code == 404
        resources = await c["agent"].get("/api/v1/agent/resources", headers=headers)
        assert resources.status_code == 200 and resources.json()["items"] == []
        for kind, identity in [("note", note), ("resource", source)]:
            r = await c["agent"].get(f"/api/v1/agent/entities/{kind}/{identity}", headers=headers)
            assert r.status_code == 404 and "PRIVATE-REPORT-SENTINEL" not in r.text


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agent_edges_recheck_endpoints_and_rejected_identities(agent_case):
    c = agent_case
    source = (await decide(c, await submit(c))).json()["receipt"]["id"]
    base = c["library"].replace("/library/resources", "/research")
    question = await c["client"].post(
        base + "/question-tree", headers=c["csrf"], json={"question": "Synthetic question"}
    )
    assert question.status_code == 201, question.text
    payload = {
        "kind": "edge",
        "from_type": "resource",
        "from_id": source,
        "to_type": "question",
        "to_id": question.json()["id"],
        "relation": "addresses",
        "reason": "Synthetic evidence",
    }
    pending = await submit(c, payload)
    accepted = await decide(c, pending, payload={**payload, "reason": "Owner explanation"})
    assert accepted.status_code == 200, accepted.text
    edge_id = accepted.json()["receipt"]["id"]
    edges = (await c["client"].get(base + "/knowledge/edges")).json()["edges"]
    edge = next(e for e in edges if e["id"] == edge_id)
    assert edge["origin"] == "user" and edge["status"] == "confirmed" and edge["ai_run_id"] is None
    rejected = await c["client"].post(
        base + f"/knowledge/edges/{edge_id}/decision",
        headers=c["csrf"],
        json={"expected_version": edge["version"], "status": "rejected"},
    )
    assert rejected.status_code == 200, rejected.text
    again = await submit(c, payload)
    denied = await decide(c, again)
    assert denied.status_code == 409 and denied.json()["code"] == "KNOWLEDGE_EDGE_TERMINAL"
    assert (await decide(c, again, decision="discarded")).status_code == 200
    missing = await c["agent"].post(
        "/api/v1/agent/inbox",
        json={"submission_key": str(uuid4()), "payload": {**payload, "from_id": str(uuid4())}},
    )
    assert missing.status_code == 404
    pending = await submit(c, {**payload, "reason": "Recheck before accepting"})
    deleted = await c["client"].request(
        "DELETE", c["library"] + "/" + source, headers=c["csrf"], json={"expected_version": 1}
    )
    assert deleted.status_code == 204, deleted.text
    assert (await decide(c, pending)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_revocation_while_authorization_waits_is_rechecked(agent_case):
    from logion_api.db import engine
    from logion_api.identity.models import User
    from sqlalchemy import event

    c = agent_case
    waiting = asyncio.Event()

    def reached(_conn, _cursor, statement, _parameters, _context, _many):
        if "FROM users" in statement and "FOR SHARE" in statement:
            waiting.set()

    async with session_factory() as db:
        token = await db.get(AgentToken, UUID(c["issued"]["detail"]["id"]))
        await db.scalar(select(User.id).where(User.id == token.user_id).with_for_update())
        event.listen(engine.sync_engine, "before_cursor_execute", reached)
        try:
            task = asyncio.create_task(c["agent"].get("/api/v1/agent/resources"))
            await asyncio.wait_for(waiting.wait(), timeout=5)
            token.revoked_at = utc_now()
            await db.commit()
            assert (await task).status_code == 401
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", reached)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_per_token_rate_limit_and_denial_audit(agent_case):
    import time

    from redis.asyncio import Redis

    c = agent_case
    identity = c["issued"]["detail"]["id"]
    async with Redis.from_url(get_settings().redis_url) as redis:
        await redis.set(f"logion:rate:agent_token:{identity}:{int(time.time()) // 60}", 120, ex=65)
    r = await c["agent"].get("/api/v1/agent/resources")
    assert r.status_code == 429 and r.headers["cache-control"] == "private, no-store"
    async with session_factory() as db:
        audit = await db.scalar(
            select(AuditEvent).where(
                AuditEvent.target_id == UUID(identity), AuditEvent.result == "denied"
            )
        )
        assert audit is not None and audit.event_metadata["status"] == 429


@pytest.mark.integration
@pytest.mark.asyncio
async def test_account_lifecycle_revokes_pat_and_cleans_dependent_notes(agent_case):
    from logion_api.identity.models import User
    from logion_api.portability.deletion_service import AccountDeletionService
    from logion_api.portability.models import AccountDeletionRequest

    c = agent_case
    report = await submit(
        c, {"kind": "report", "title": "Private report", "markdown_body": "Draft"}
    )
    accepted = await decide(c, report)
    assert accepted.status_code == 200
    note_id = UUID(accepted.json()["receipt"]["id"])
    await submit(c, key="pending-before-deletion")
    user_id = UUID((await c["client"].get("/api/v1/auth/me")).json()["id"])
    requested = await c["client"].post(
        "/api/v1/account-deletion",
        headers=c["csrf"],
        json={"confirmation": "DELETE MY ACCOUNT"},
    )
    assert requested.status_code == 202, requested.text
    assert (await c["agent"].get("/api/v1/agent/resources")).status_code == 403
    async with session_factory() as db:
        token = await db.get(AgentToken, UUID(c["issued"]["detail"]["id"]))
        assert token.revoked_at is not None
        request = await db.get(AccountDeletionRequest, UUID(requested.json()["id"]))
        request.delete_after = utc_now() - timedelta(seconds=1)
        await db.commit()
    assert await AccountDeletionService(get_settings()).execute_next()
    async with session_factory() as db:
        assert await db.get(Note, note_id) is None
        for model in [AgentInboxItem, AgentToken]:
            assert not await db.scalar(
                select(func.count()).select_from(model).where(model.user_id == user_id)
            )
        assert (await db.get(User, user_id)).status == "deleted"
