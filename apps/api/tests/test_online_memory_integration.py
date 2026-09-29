import asyncio
import hashlib
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.content.models import Note
from logion_api.content.yjs_documents import state_from_markdown
from logion_api.db import session_factory, utc_now
from logion_api.identity.models import AuditEvent, User
from logion_api.main import app
from logion_api.memory.models import (
    KnowledgeSourceLink,
    MasteryRecord,
    QuizAttempt,
    ReviewSchedule,
    Topic,
)
from logion_api.sync.models import SyncChange
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from logion_api.workspaces.service import WorkspaceService
from sqlalchemy import func, select
from test_online_planning_integration import online_case as online_case
from test_online_planning_integration import pull

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def path(c):
    return c["path"].replace("/goals", "/memory")


async def post(c, suffix, data):
    response = await c["client"].post(path(c) + suffix, headers=c["csrf"], json=data)
    assert response.status_code == 201, response.text
    return response.json()


async def topic(c, title="Legacy concept"):
    return await post(
        c, "/topics", {"id": str(uuid4()), "title": title, "description": "Explain it"}
    )


async def quiz(c, t, mode="exact_match"):
    return await post(
        c,
        "/quizzes",
        {
            "id": str(uuid4()),
            "topic_id": t["id"],
            "prompt": "What is four?",
            "answer_key": "Four",
            "explanation": "Two plus two",
            "evaluation_mode": mode,
        },
    )


def answer(*, correct=None, cause="recall_gap", schedule=None, pattern=None):
    return {
        "id": str(uuid4()),
        "error_pattern_id": pattern or str(uuid4()),
        "schedule_id": schedule or str(uuid4()),
        "response_text": "wrong",
        "confidence": 2,
        "duration_seconds": 7,
        "self_assessed_correct": correct,
        "error_cause": cause,
    }


async def test_online_recall_scoring_owner_mastery_and_existing_cursor(online_case):
    c = online_case
    t = await topic(c)
    q = await quiz(c, t)
    listed = await c["client"].get(f"{path(c)}/topics/{t['id']}/quizzes")
    assert (
        listed.status_code == 200
        and "answer_key" not in listed.text
        and "Two plus two" not in listed.text
    )
    assert not listed.json()["quiz_items"][0]["has_attempts"]
    before = await pull(c)
    assert {x["entity_type"] for x in before} == {"topic", "quiz_item"}
    wrong = await post(c, f"/quizzes/{q['id']}/attempts", answer())
    assert not wrong["is_correct"] and wrong["answer_key"] == "Four"
    assert wrong["error_pattern"]["occurrence_count"] == 1
    assert wrong["review_schedule"]["status"] == "due"
    detail = (await c["client"].get(f"{path(c)}/topics/{t['id']}")).json()
    assert detail["topic"]["mastery"] is None
    assert [
        i["id"] for i in (await c["client"].get(path(c) + "/topics?due_only=true")).json()["topics"]
    ] == [t["id"]]
    good = answer(schedule=wrong["review_schedule"]["id"], pattern=wrong["error_pattern"]["id"])
    good["response_text"] = "  FOUR  "
    result = await post(c, f"/quizzes/{q['id']}/attempts", good)
    assert result["is_correct"] and result["error_cause"] is None
    assert (await c["client"].get(f"{path(c)}/topics/{t['id']}")).json()["topic"]["mastery"] is None
    body = {
        "mastery_id": str(uuid4()),
        "schedule_id": wrong["review_schedule"]["id"],
        "expected_version": 0,
        "confirmed_level": "familiar",
    }
    confirmed = await c["client"].put(
        f"{path(c)}/topics/{t['id']}/mastery", headers=c["csrf"], json=body
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["review_schedule"]["interval_days"] == 4
    changes = await pull(c)
    assert {i["entity_type"] for i in changes} == {
        "quiz_attempt",
        "error_pattern",
        "review_schedule",
        "mastery",
    }
    assert len(changes) == 6
    assert (
        await c["client"].put(f"{path(c)}/topics/{t['id']}/mastery", headers=c["csrf"], json=body)
    ).status_code == 409
    assert await pull(c) == []


async def test_self_assessment_validation_corrections_and_retirement_preserve_history(online_case):
    c = online_case
    c["client"].headers["X-Logion-Sync-Capabilities"] = "entity-deletion-v1"
    t = await topic(c)
    q = await quiz(c, t, "self_assessed")
    url = f"{path(c)}/quizzes/{q['id']}"
    assert (
        await c["client"].post(url + "/attempts", headers=c["csrf"], json=answer())
    ).status_code == 422
    attempt = await post(c, f"/quizzes/{q['id']}/attempts", answer(correct=True, cause=None))
    payload = {**q, "id": q["id"], "expected_version": 1, "prompt": "Updated prompt"}
    payload.pop("version")
    update = await c["client"].patch(url, headers=c["csrf"], json=payload)
    assert update.status_code == 200, update.text
    assert "answer_key" not in update.text
    assert (await c["client"].patch(url, headers=c["csrf"], json=payload)).status_code == 409
    payload.update(expected_version=2, evaluation_mode="exact_match")
    assert (await c["client"].patch(url, headers=c["csrf"], json=payload)).status_code == 422
    await pull(c)
    preview = (await c["client"].get(f"{path(c)}/entities/quiz_item/{q['id']}/deletion")).json()
    assert preview["can_delete"] and preview["server_version"] == 2
    deleted = await c["client"].request(
        "DELETE",
        f"{path(c)}/entities/quiz_item/{q['id']}",
        headers=c["csrf"],
        json={"expected_version": 2},
    )
    assert deleted.status_code == 204, deleted.text
    assert (await c["client"].get(f"{path(c)}/topics/{t['id']}/quizzes")).json()["quiz_items"] == []
    history = (await c["client"].get(f"{path(c)}/topics/{t['id']}/attempts")).json()["attempts"]
    assert history[0]["id"] == attempt["id"] and history[0]["answer_key"] == "Four"
    assert (
        await c["client"].post(
            url + "/attempts", headers=c["csrf"], json=answer(correct=True, cause=None)
        )
    ).status_code == 404
    blocked = (await c["client"].get(f"{path(c)}/entities/topic/{t['id']}/deletion")).json()
    assert not blocked["can_delete"] and blocked["blockers"]["quiz_attempt_count"] == 1
    changes = await pull(c)
    assert (
        len(changes) == 1 and changes[0]["entity_type"] == "quiz_item" and changes[0]["tombstone"]
    )


async def test_source_navigation_handles_shifted_utf16_offsets_and_deleted_notes(online_case):
    c = online_case
    excerpt = "原文实验结论"
    t = await topic(c)
    note_id, link_id = uuid4(), uuid4()
    async with session_factory() as db:
        row = await db.get(Topic, UUID(t["id"]))
        row.description = "来源笔记：合成笔记\n\n" + excerpt
        db.add(
            Note(
                id=note_id,
                workspace_id=row.workspace_id,
                space_id=row.space_id,
                title="Synthetic source",
                markdown_body="😀 shifted " + excerpt,
                yjs_state=state_from_markdown("😀 shifted " + excerpt),
                created_by=row.created_by,
                updated_by=row.updated_by,
            )
        )
        db.add(
            KnowledgeSourceLink(
                id=link_id,
                workspace_id=row.workspace_id,
                space_id=row.space_id,
                source_kind="note",
                source_id=note_id,
                target_kind="topic",
                target_id=row.id,
                excerpt_sha256=hashlib.sha256(excerpt.encode()).hexdigest(),
                excerpt_start=0,
                excerpt_end=6,
                source_version=1,
                created_by=row.created_by,
                updated_by=row.updated_by,
            )
        )
        await db.commit()
    link = f"{path(c)}/sources/{link_id}"
    located = (await c["client"].get(link)).json()
    assert located["state"] == "valid" and located["start"] == 11 and located["end"] == 17
    async with session_factory() as db:
        note = await db.get(Note, note_id)
        note.markdown_body = "Different source body"
        note.version += 1
        await db.commit()
    assert (await c["client"].get(link)).json()["state"] == "modified"
    async with session_factory() as db:
        note = await db.get(Note, note_id)
        note.deleted_at = utc_now()
        await db.commit()
    hidden = (await c["client"].get(link)).json()
    assert hidden["state"] == "deleted" and hidden["note_title"] is None
    assert (await c["client"].get(link.replace(c["sp"], str(uuid4())))).status_code == 404


async def test_memory_ledger_failure_rolls_back_attempt_schedule_and_audit(
    online_case, monkeypatch
):
    c = online_case
    t = await topic(c)
    q = await quiz(c, t)
    await pull(c)
    original = SyncLedgerService.append_applied
    calls = 0

    async def fail(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("synthetic memory ledger failure")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(SyncLedgerService, "append_applied", fail)
    with pytest.raises(RuntimeError, match="synthetic memory ledger failure"):
        await c["client"].post(
            f"{path(c)}/quizzes/{q['id']}/attempts", headers=c["csrf"], json=answer()
        )
    async with session_factory() as db:
        for model in (QuizAttempt, MasteryRecord, ReviewSchedule):
            assert (
                await db.scalar(
                    select(func.count())
                    .select_from(model)
                    .where(model.workspace_id == UUID(c["ws"]))
                )
                == 0
            )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(
                    AuditEvent.workspace_id == UUID(c["ws"]),
                    AuditEvent.event_type == "memory.quiz_attempt_recorded",
                )
            )
            == 0
        )
    assert await pull(c) == []


async def test_online_memory_boundaries_pagination_and_private_isolation(online_case):
    c = online_case
    t = await topic(c)
    second = await topic(c, "Second concept")
    page = (await c["client"].get(path(c) + "/topics?limit=1")).json()
    next_page = (
        await c["client"].get(
            path(c) + "/topics", params={"cursor": page["next_cursor"], "limit": 1}
        )
    ).json()
    assert {i["id"] for i in page["topics"] + next_page["topics"]} == {t["id"], second["id"]}
    assert next_page["next_cursor"] is None
    q = await quiz(c, t)
    url = f"{path(c)}/quizzes/{q['id']}/attempts"
    assert (await c["client"].post(url, json=answer())).status_code == 403
    assert (
        await c["client"].post(
            url, headers={**c["csrf"], "Origin": "http://untrusted.invalid"}, json=answer()
        )
    ).status_code == 403
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(path(c) + "/topics")).status_code == 404
    c["flags"]["research_v3_enabled"] = True
    async with session_factory() as db:
        row = await db.get(Topic, UUID(second["id"]))
        row.research_owner_id = row.created_by
        row.title = "PRIVATE_MEMORY_SENTINEL"
        await db.commit()
    listed = await c["client"].get(path(c) + "/topics")
    assert "PRIVATE_MEMORY_SENTINEL" not in listed.text
    for suffix in ["", "/quizzes", "/attempts"]:
        assert (
            await c["client"].get(f"{path(c)}/topics/{second['id']}{suffix}")
        ).status_code == 404
    uid = uuid4().hex
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(f"2001:db8::{uid[:4]}:{uid[4:8]}", 51008)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        email = f"review-viewer-{uid}@example.com"
        result = await other.post(
            "/api/v1/auth/register",
            json={"email": email, "password": f"synthetic-{uuid4()}", "device_name": "Viewer"},
        )
        assert result.status_code == 201
        assert (await other.get(path(c) + "/topics")).status_code == 404
        async with session_factory() as db:
            viewer = await db.scalar(select(User).where(User.email == email))
            space = await db.get(Space, UUID(c["sp"]))
            space.visibility, space.owner_user_id = "shared", None
            db.add(
                WorkspaceMembership(
                    workspace_id=space.workspace_id,
                    user_id=viewer.id,
                    role="viewer",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            await db.commit()
        headers = {"X-CSRF-Token": other.cookies["logion_csrf"]}
        assert not (await other.get(path(c) + "/topics")).json()["can_edit"]
        assert (
            await other.post(
                path(c) + "/topics", headers=headers, json={"id": str(uuid4()), "title": "Denied"}
            )
        ).status_code == 403
        assert (await other.post(url, headers=headers, json=answer())).status_code == 201
        assert (await c["client"].get(f"{path(c)}/topics/{t['id']}/attempts")).json()[
            "attempts"
        ] == []
        assert "PRIVATE_MEMORY_SENTINEL" not in (await other.get(path(c) + "/topics")).text


async def test_memory_rechecks_access_after_lock_wait(online_case, monkeypatch):
    c = online_case
    t = await topic(c)
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
            c["client"].put(
                f"{path(c)}/topics/{t['id']}/mastery",
                headers=c["csrf"],
                json={
                    "mastery_id": str(uuid4()),
                    "schedule_id": str(uuid4()),
                    "expected_version": 0,
                    "confirmed_level": "familiar",
                },
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
        assert (
            await db.scalar(
                select(func.count())
                .select_from(MasteryRecord)
                .where(MasteryRecord.workspace_id == UUID(c["ws"]))
            )
            == 0
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(SyncChange)
                .where(SyncChange.workspace_id == UUID(c["ws"]))
            )
            == 1
        )


async def test_prerequisite_cycle_protection_and_atomic_source_retirement(online_case):
    c = online_case
    c["client"].headers["X-Logion-Sync-Capabilities"] = "entity-deletion-v1"
    first, second = await topic(c), await topic(c, "Dependent concept")
    dependency = await post(
        c,
        "/dependencies",
        {
            "id": str(uuid4()),
            "prerequisite_topic_id": first["id"],
            "dependent_topic_id": second["id"],
        },
    )
    cycle = await c["client"].post(
        path(c) + "/dependencies",
        headers=c["csrf"],
        json={
            "id": str(uuid4()),
            "prerequisite_topic_id": second["id"],
            "dependent_topic_id": first["id"],
        },
    )
    assert cycle.status_code == 409, cycle.text
    page = (await c["client"].get(f"{path(c)}/topics/{first['id']}/dependencies?limit=1")).json()
    assert page["dependencies"][0]["id"] == dependency["id"] and page["next_cursor"] is None
    assert not (await c["client"].get(f"{path(c)}/entities/topic/{first['id']}/deletion")).json()[
        "can_delete"
    ]
    await pull(c)
    deleted = await c["client"].request(
        "DELETE",
        f"{path(c)}/entities/topic_dependency/{dependency['id']}",
        headers=c["csrf"],
        json={"expected_version": 1},
    )
    assert deleted.status_code == 204
    assert (await c["client"].get(f"{path(c)}/entities/topic/{first['id']}/deletion")).json()[
        "can_delete"
    ]
    assert (await pull(c))[0]["tombstone"]
    # Retirement keeps learning data, but retires navigation links to the retired item.
    q = await quiz(c, first)
    link_id = uuid4()
    async with session_factory() as db:
        row = await db.get(Topic, UUID(first["id"]))
        db.add(
            KnowledgeSourceLink(
                id=link_id,
                workspace_id=row.workspace_id,
                space_id=row.space_id,
                source_kind="note",
                source_id=uuid4(),
                target_kind="quiz_item",
                target_id=UUID(q["id"]),
                excerpt_sha256="0" * 64,
                excerpt_start=None,
                excerpt_end=None,
                source_version=1,
                created_by=row.created_by,
                updated_by=row.updated_by,
            )
        )
        await db.commit()
    await pull(c)
    assert (
        await c["client"].request(
            "DELETE",
            f"{path(c)}/entities/quiz_item/{q['id']}",
            headers=c["csrf"],
            json={"expected_version": 1},
        )
    ).status_code == 204
    changes = await pull(c)
    assert {change["entity_type"] for change in changes} == {"quiz_item", "source_link"}
    assert all(change["tombstone"] for change in changes)
