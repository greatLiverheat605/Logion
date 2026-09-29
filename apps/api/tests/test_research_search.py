import hashlib
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Resource
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import User
from logion_api.knowledge_space.models import SourceExcerpt
from logion_api.library.text_models import SourceText
from logion_api.main import app
from logion_api.memory.models import QuizItem, Topic
from logion_api.research.models import ResearchIdea
from logion_api.workspaces.models import Space, WorkspaceMembership
from pydantic import SecretStr
from sqlalchemy import event, select
from test_online_planning_integration import online_case as online_case

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def path(c):
    return c["path"].replace("/goals", "/search")


async def seed(c):
    c["flags"].update(
        knowledge_cursor_active_key_id="synthetic",
        knowledge_cursor_keys={"synthetic": SecretStr(uuid4().hex + uuid4().hex)},
    )
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        scope = dict(
            workspace_id=UUID(c["ws"]),
            space_id=UUID(c["sp"]),
            created_by=user.id,
            updated_by=user.id,
        )
        resource = Resource(
            **scope,
            research_owner_id=user.id,
            title="Needle café 50%_\\",
            resource_type="paper",
            sha256="a" * 64,
        )
        legacy = Topic(**scope, title="Needle shared knowledge", description="Existing concept")
        private = Topic(
            **scope,
            research_owner_id=user.id,
            title="Needle private knowledge",
            description="OWNER_PRIVATE_DESCRIPTION",
        )
        db.add_all([resource, legacy, private])
        await db.flush()
        text = "Introduction\n" + "Needle on page two\n"
        db.add(
            SourceText(
                workspace_id=scope["workspace_id"],
                space_id=scope["space_id"],
                resource_id=resource.id,
                text=text,
                page_offsets=[{"start": 0, "end": 13}, {"start": 13, "end": len(text)}],
                file_sha256="a" * 64,
                extracted_by="pdfjs@5.0.0",
            )
        )
        excerpt = SourceExcerpt(
            **scope,
            resource_id=resource.id,
            resource_version=1,
            excerpt_text="Needle quotation",
            source_version_key="synthetic",
            source_version_sha256=hashlib.sha256(text.encode()).hexdigest(),
            excerpt_sha256=hashlib.sha256(b"Needle quotation").hexdigest(),
            page_start=2,
            page_end=2,
        )
        quizzes = [
            QuizItem(
                **scope,
                topic_id=t.id,
                prompt="Needle question",
                answer_key="HIDDEN_ANSWER_SENTINEL",
                explanation="HIDDEN_EXPLANATION_SENTINEL",
                evaluation_mode="self_assessed",
                research_owner_id=user.id if t is private else None,
                resource_id=resource.id if t is private else None,
                origin="user" if t is private else None,
            )
            for t in (legacy, private)
        ]
        db.add_all(
            [
                excerpt,
                *quizzes,
                ResearchIdea(
                    **scope,
                    user_id=user.id,
                    title="Needle idea",
                    body="IDEA_SENTINEL",
                ),
            ]
        )
        await db.commit()
        return user.id, resource.id, legacy.id, private.id, excerpt.id


async def get(c, **params):
    r = await c["client"].get(path(c), params={"q": "needle", **params})
    assert r.status_code == 200, r.text
    assert r.headers["Cache-Control"] == "private, no-store"
    return r.json()


async def test_search_all_kinds_literal_unicode_page_no_answers_or_writes(online_case):
    c = online_case
    _, resource, _, private, _ = await seed(c)
    statements = []
    async with session_factory() as db:
        engine = db.bind.sync_engine

    def observe(conn, cursor, statement, parameters, context, many):
        statements.append(statement.lower())

    event.listen(engine, "before_cursor_execute", observe)
    try:
        result = await get(c)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert {i["kind"] for i in result["items"]} == {"resource", "text", "excerpt", "topic", "quiz"}
    assert len(result["items"]) == 7
    assert not any(s.lstrip().startswith(("insert", "update", "delete")) for s in statements)
    assert not any("research_ideas" in s or "knowledge_edges" in s for s in statements)
    for i in result["items"]:
        assert len(i["snippet"]) <= 240
        assert "HIDDEN_" not in str(i) and "IDEA_SENTINEL" not in str(i)
        if i["kind"] in {"text", "excerpt"}:
            assert i["page"] == 2 and i["resource_id"] == str(resource)
    assert len((await get(c, q="cafe\u0301"))["items"]) == 1
    assert len((await get(c, q="50%_\\"))["items"]) == 1
    assert (await get(c, q="%_does_not_match"))["items"] == []
    assert (await get(c, q="HIDDEN_ANSWER"))["items"] == []
    assert (await get(c, q="IDEA_SENTINEL"))["items"] == []
    detail = await c["client"].get(f"{path(c)}/concepts/{private}")
    assert detail.status_code == 200 and detail.json()["description"] == "OWNER_PRIVATE_DESCRIPTION"
    for query in [" ", " x ", "ab\x00", "x" * 121]:
        assert (await c["client"].get(path(c), params={"q": query})).status_code == 422


async def test_search_signed_pagination_and_current_parent_state(online_case):
    c = online_case
    _, resource, legacy, private, excerpt = await seed(c)
    first = await get(c, limit=2)
    token = first["next_cursor"]
    assert token
    collected = first["items"][:]
    while token:
        result = await get(c, limit=2, cursor=token)
        collected.extend(result["items"])
        token = result["next_cursor"]
    assert len({(i["kind"], i["id"]) for i in collected}) == len(collected) == 7
    for values in [
        {"cursor": first["next_cursor"] + "a"},
        {"cursor": first["next_cursor"], "q": "other"},
        {"cursor": first["next_cursor"], "kind": "topic"},
        {"cursor": first["next_cursor"], "limit": 3},
    ]:
        response = await c["client"].get(path(c), params={"q": "needle", "limit": 2, **values})
        assert response.status_code == 400
    async with session_factory() as db:
        row = await db.get(Resource, resource)
        row.sha256 = "b" * 64
        await db.commit()
    assert (await get(c, kind="text"))["items"] == []
    async with session_factory() as db:
        row = await db.get(SourceExcerpt, excerpt)
        row.status, row.stale_at = "stale", utc_now()
        await db.commit()
    assert (await get(c, kind="excerpt"))["items"] == []
    async with session_factory() as db:
        row = await db.get(Resource, resource)
        row.deleted_at = utc_now()
        row = await db.get(Topic, legacy)
        row.deleted_at = utc_now()
        await db.commit()
    remaining = await get(c)
    assert [(i["kind"], i["id"]) for i in remaining["items"]] == [("topic", str(private))]
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(path(c), params={"q": "needle"})).status_code == 404
    assert (await c["client"].get(f"{path(c)}/concepts/{private}")).status_code == 404


async def test_search_peer_private_space_revocation_and_cursor_binding(online_case):
    c = online_case
    owner, _, _, private, _ = await seed(c)
    token = (await get(c, limit=1))["next_cursor"]
    uid = uuid4().hex
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(f"2001:db8::{uid[:4]}:{uid[4:8]}", 51002)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as peer:
        email = f"search-peer-{uid}@example.com"
        r = await peer.post(
            "/api/v1/auth/register",
            json={"email": email, "password": f"synthetic-{uuid4()}", "device_name": "Search peer"},
        )
        assert r.status_code == 201
        assert (await peer.get(path(c), params={"q": "needle"})).status_code == 404
        async with session_factory() as db:
            user = await db.scalar(select(User).where(User.email == email))
            membership = WorkspaceMembership(
                workspace_id=UUID(c["ws"]),
                user_id=user.id,
                role="viewer",
                status="active",
                joined_at=utc_now(),
            )
            db.add(membership)
            await db.commit()
        assert (await peer.get(path(c), params={"q": "needle"})).status_code == 404
        async with session_factory() as db:
            space = await db.get(Space, UUID(c["sp"]))
            space.visibility, space.owner_user_id = "shared", None
            await db.commit()
        r = await peer.get(path(c), params={"q": "needle"})
        assert r.status_code == 200, r.text
        assert {i["kind"] for i in r.json()["items"]} == {"topic", "quiz"}
        assert len(r.json()["items"]) == 2 and not any(i["personal"] for i in r.json()["items"])
        assert (await peer.get(f"{path(c)}/concepts/{private}")).status_code == 404
        assert (
            await peer.get(path(c), params={"q": "needle", "limit": 1, "cursor": token})
        ).status_code == 400
        peer_token = (await peer.get(path(c), params={"q": "needle", "limit": 1})).json()[
            "next_cursor"
        ]
        async with session_factory() as db:
            row = await db.get(WorkspaceMembership, membership.id)
            row.status = "revoked"
            await db.commit()
        assert (
            await peer.get(path(c), params={"q": "needle", "limit": 1, "cursor": peer_token})
        ).status_code == 404
    c["flags"]["knowledge_cursor_active_key_id"] = None
    r = await c["client"].get(path(c), params={"q": "needle"})
    assert r.status_code == 503 and r.json()["code"] == "SEARCH_CURSOR_UNAVAILABLE"


async def test_text_last_page_is_bounded_and_context_cursor_cannot_cross_space(online_case):
    c = online_case
    owner, resource, _, private, _ = await seed(c)
    cursor = (await get(c, limit=1))["next_cursor"]
    async with session_factory() as db:
        row = await db.scalar(select(SourceText).where(SourceText.resource_id == resource))
        pages = ["a" * 499 + "\n" for _ in range(1000)]
        pages[-1] = "Final needle" + "a" * 487 + "\n"
        row.text = "".join(pages)
        row.page_offsets = [{"start": i * 500, "end": (i + 1) * 500} for i in range(1000)]
        await db.commit()
    found = (await get(c, kind="text"))["items"]
    assert len(found) == 1 and found[0]["page"] == 1000
    assert len(found[0]["snippet"]) <= 240
    async with session_factory() as db:
        space = Space(
            workspace_id=UUID(c["ws"]),
            name="Another search scope",
            visibility="shared",
            created_by=owner,
            updated_by=owner,
        )
        db.add(space)
        await db.commit()
        other = str(space.id)
    r = await c["client"].get(
        path(c).replace(c["sp"], other), params={"q": "needle", "limit": 1, "cursor": cursor}
    )
    assert r.status_code == 400
    assert (
        await c["client"].get(path(c).replace(c["ws"], str(uuid4())), params={"q": "needle"})
    ).status_code == 404
    async with session_factory() as db:
        space = await db.get(Space, UUID(c["sp"]))
        space.deleted_at = utc_now()
        await db.commit()
    assert (await c["client"].get(path(c), params={"q": "needle"})).status_code == 404
    assert (await c["client"].get(f"{path(c)}/concepts/{private}")).status_code == 404
