import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory, utc_now
from logion_api.execution.models import Task
from logion_api.identity.models import AuditEvent, User
from logion_api.main import app
from logion_api.memory.models import MasteryRecord, ReviewSchedule, Topic
from logion_api.planning.models import LearningGoal
from logion_api.planning.service import PlanningService
from logion_api.sync.models import SyncChange
from logion_api.sync.service import SyncLedgerService
from logion_api.workspaces.models import Space, Workspace, WorkspaceMembership
from sqlalchemy import func, select

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


@pytest_asyncio.fixture(loop_scope="session")
async def online_case():
    original = dict(app.dependency_overrides)
    flags = {"research_v3_enabled": True, "planning_phase_revision_enabled": True}
    base = get_settings()
    app.dependency_overrides[get_settings] = lambda: base.model_copy(update=flags)
    uid = uuid4().hex
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, client=(f"2001:db8::{uid[:4]}:{uid[4:8]}", 51001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as client:
            email = f"online-{uid}@example.com"
            result = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": f"synthetic-{uuid4()}",
                    "device_name": "Online planning",
                },
            )
            assert result.status_code == 201, result.text
            ws = (await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            sp = (await client.get(f"/api/v1/workspaces/{ws}/spaces")).json()["spaces"][0]["id"]
            device = next(
                x["id"]
                for x in (await client.get("/api/v1/auth/devices")).json()["devices"]
                if x["current"]
            )
            envelope = {"workspace_id": ws, "device_id": device, "protocol_version": "sync-v1"}
            bootstrap = await client.post(
                f"/api/v1/workspaces/{ws}/sync/bootstrap",
                json={
                    **envelope,
                    "message_type": "bootstrap_request",
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200, bootstrap.text
            payload = {
                "goal_id": str(uuid4()),
                "plan_id": str(uuid4()),
                "plan_version_id": str(uuid4()),
                "title": "Synthetic goal",
                "description": "Keep this description",
                "desired_outcome": "Explain a paper",
                "weekly_minutes": 90,
                "target_date": "2027-01-01",
                "phases": [
                    {
                        "id": str(uuid4()),
                        "title": title,
                        "description": "",
                        "position": i,
                        "estimated_minutes": 30,
                        "acceptance_criteria": ["Explain evidence"],
                    }
                    for i, title in enumerate(["Read", "Explain"])
                ],
            }
            yield {
                "client": client,
                "ws": ws,
                "sp": sp,
                "email": email,
                "path": f"/api/v1/workspaces/{ws}/spaces/{sp}/research/goals",
                "csrf": {"X-CSRF-Token": client.cookies["logion_csrf"]},
                "payload": payload,
                "pull": {
                    **envelope,
                    "message_type": "pull_request",
                    "limit": 100,
                    "sync_epoch": bootstrap.json()["sync_epoch"],
                    "cursor": bootstrap.json()["cursor"],
                },
                "flags": flags,
            }
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original)


async def create(case):
    r = await case["client"].post(case["path"], headers=case["csrf"], json=case["payload"])
    assert r.status_code == 201, r.text
    return r.json()


async def pull(case):
    r = await case["client"].post(f"/api/v1/workspaces/{case['ws']}/sync/pull", json=case["pull"])
    assert r.status_code == 200, r.text
    case["pull"]["cursor"] = r.json()["next_cursor"]
    return r.json()["changes"]


async def test_online_goal_updates_reach_existing_sync_cursor(online_case):
    c = online_case
    goal = await create(c)
    changes = await pull(c)
    assert len(changes) == 1 and changes[0]["operation_type"] == "create"
    path = f"{c['path']}/{goal['goal_id']}"
    changed = await c["client"].patch(
        path,
        headers=c["csrf"],
        json={
            "expected_version": 1,
            "title": "Renamed",
            "target_date": None,
            "weekly_minutes": 0,
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["description"] == c["payload"]["description"]
    assert changed.json()["target_date"] is None
    changes = await pull(c)
    assert len(changes) == 1
    assert changes[0]["server_version"] == 2
    assert changes[0]["payload"]["title"] == "Renamed"
    assert changes[0]["payload"]["weekly_minutes"] == 0
    assert changes[0]["payload"]["target_date"] is None
    phases = [{**p, "archived": i == 1} for i, p in enumerate(reversed(c["payload"]["phases"]))]
    changed = await c["client"].put(
        path + "/phases", headers=c["csrf"], json={"expected_version": 2, "phases": phases}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["plan_version_id"] == goal["plan_version_id"]
    assert changed.json()["phases"][1]["archived_at"] is not None
    assert (await pull(c))[0]["payload"]["phases"][1]["archived_at"] is not None
    published = await c["client"].post(
        path + "/publish",
        headers=c["csrf"],
        json={"expected_goal_version": 3, "expected_plan_version": 1},
    )
    assert published.status_code == 200, published.text
    assert published.json()["goal_status"] == "active"
    assert (await pull(c))[0]["server_version"] == 4
    async with session_factory() as db:
        audit = await db.scalar(
            select(AuditEvent).where(
                AuditEvent.target_id == UUID(goal["goal_id"]),
                AuditEvent.event_type == "planning.goal_updated",
            )
        )
        assert audit is not None
        assert "Renamed" not in str(audit.event_metadata)


async def test_goal_write_guards_and_reference_protection(online_case):
    c = online_case
    goal = await create(c)
    await pull(c)
    path = f"{c['path']}/{goal['goal_id']}"
    for body, headers, expected in [
        ({"expected_version": 1, "title": "Denied"}, {}, 403),
        (
            {"expected_version": 1, "title": "Denied"},
            {**c["csrf"], "Origin": "http://untrusted.invalid"},
            403,
        ),
        ({"expected_version": 2, "title": "Stale"}, c["csrf"], 409),
        ({"expected_version": 1, "title": None}, c["csrf"], 422),
        ({"expected_version": 1, "weekly_minutes": 10081}, c["csrf"], 422),
        ({"expected_version": 1, "desired_outcome": " "}, c["csrf"], 422),
        ({"expected_version": 1}, c["csrf"], 422),
    ]:
        r = await c["client"].patch(path, headers=headers, json=body)
        assert r.status_code == expected, r.text
    c["flags"]["planning_phase_revision_enabled"] = False
    r = await c["client"].patch(
        path, headers=c["csrf"], json={"expected_version": 1, "title": "Disabled"}
    )
    assert r.status_code == 403 and r.json()["code"] == "FEATURE_DISABLED"
    c["flags"]["planning_phase_revision_enabled"] = True
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        db.add(
            Task(
                workspace_id=UUID(c["ws"]),
                space_id=UUID(c["sp"]),
                goal_id=UUID(goal["goal_id"]),
                phase_id=UUID(goal["phases"][0]["id"]),
                title="Historical task",
                created_by=user.id,
                updated_by=user.id,
                deleted_at=utc_now(),
            )
        )
        await db.commit()
    listed = await c["client"].get(c["path"])
    assert listed.json()["goals"][0]["phases"][0]["removal_allowed"] is False
    phases = [{**p, "removed": i == 0} for i, p in enumerate(c["payload"]["phases"])]
    r = await c["client"].put(
        path + "/phases", headers=c["csrf"], json={"expected_version": 1, "phases": phases}
    )
    assert r.status_code == 409 and r.json()["code"] == "PLANNING_PHASE_REFERENCED"
    assert await pull(c) == []
    c["flags"]["research_v3_enabled"] = False
    assert (await c["client"].get(c["path"])).status_code == 404
    c["flags"]["research_v3_enabled"] = True
    assert (
        await c["client"].patch(
            path.replace(c["sp"], str(uuid4())),
            headers=c["csrf"],
            json={"expected_version": 1, "title": "Wrong space"},
        )
    ).status_code == 404
    async with session_factory() as db:
        member = await db.scalar(
            select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
        )
        member.status = "revoked"
        await db.commit()
    assert (
        await c["client"].patch(
            path, headers=c["csrf"], json={"expected_version": 1, "title": "Revoked"}
        )
    ).status_code == 404


async def test_goal_ledger_failure_rolls_back_business_update(online_case, monkeypatch):
    c = online_case
    goal = await create(c)

    async def fail(*args, **kwargs):
        raise RuntimeError("Synthetic ledger failure")

    monkeypatch.setattr(SyncLedgerService, "append_applied", fail)
    with pytest.raises(RuntimeError, match="Synthetic ledger failure"):
        await c["client"].patch(
            f"{c['path']}/{goal['goal_id']}",
            headers=c["csrf"],
            json={"expected_version": 1, "title": "Must roll back"},
        )
    async with session_factory() as db:
        row = await db.get(LearningGoal, UUID(goal["goal_id"]))
        assert row.version == 1 and row.title == "Synthetic goal"
        assert (
            await db.scalar(
                select(func.count()).select_from(SyncChange).where(SyncChange.entity_id == row.id)
            )
            == 1
        )
        assert (
            await db.scalar(
                select(func.count())
                .select_from(AuditEvent)
                .where(
                    AuditEvent.target_id == row.id, AuditEvent.event_type == "planning.goal_updated"
                )
            )
            == 0
        )


async def test_review_queue_is_scoped_ordered_and_uses_exclusive_day_boundary(online_case):
    c = online_case
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == c["email"]))
        for title, private, confirmed, status, deleted, due in [
            ("legacy earlier", False, False, "scheduled", False, "2026-01-01T12:00:00+00:00"),
            ("reading same time", True, True, "due", False, "2026-01-01T12:00:00+00:00"),
            ("unconfirmed private", True, False, "due", False, "2026-01-01T11:00:00+00:00"),
            ("deleted topic", False, False, "due", True, "2026-01-01T11:00:00+00:00"),
            ("skipped", False, False, "skipped", False, "2026-01-01T11:00:00+00:00"),
            ("next local day", False, False, "scheduled", False, "2026-01-01T16:00:00+00:00"),
        ]:
            topic = Topic(
                workspace_id=UUID(c["ws"]),
                space_id=UUID(c["sp"]),
                title=title,
                research_owner_id=user.id if private else None,
                created_by=user.id,
                updated_by=user.id,
                deleted_at=utc_now() if deleted else None,
            )
            db.add(topic)
            await db.flush()
            db.add(
                ReviewSchedule(
                    workspace_id=UUID(c["ws"]),
                    space_id=UUID(c["sp"]),
                    topic_id=topic.id,
                    user_id=user.id,
                    status=status,
                    source="manual",
                    interval_days=1,
                    next_review_at=datetime.fromisoformat(due),
                )
            )
            if confirmed:
                db.add(
                    MasteryRecord(
                        workspace_id=UUID(c["ws"]),
                        space_id=UUID(c["sp"]),
                        topic_id=topic.id,
                        user_id=user.id,
                        confirmed_by=user.id,
                        confirmed_level="familiar",
                        confirmed_at=utc_now(),
                    )
                )
        await db.commit()
    path = c["path"].replace("/goals", "/review-queue")
    query = {"before": "2026-01-02T00:00:00+08:00", "limit": 1}
    first = await c["client"].get(path, params=query)
    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 1 and first.json()["next_cursor"]
    second = await c["client"].get(path, params={**query, "cursor": first.json()["next_cursor"]})
    assert second.status_code == 200, second.text
    assert second.json()["next_cursor"] is None
    rows = first.json()["items"] + second.json()["items"]
    assert {row["title"] for row in rows} == {"legacy earlier", "reading same time"}
    assert [row["id"] for row in rows] == sorted(row["id"] for row in rows)
    assert {row["kind"] for row in rows} == {"legacy", "reading"}
    for params in [
        {"before": "2026-01-01T00:00:00"},
        {"cursor": "malformed"},
        {"cursor": f"2026-01-01T00:00:00|{uuid4()}"},
    ]:
        assert (await c["client"].get(path, params=params)).status_code == 422
    async with session_factory() as db:
        assert (
            await db.scalar(
                select(func.count())
                .select_from(SyncChange)
                .where(SyncChange.workspace_id == UUID(c["ws"]))
            )
            == 0
        )


async def test_shared_goal_permissions_and_private_review_isolation(online_case):
    c = online_case
    goal = await create(c)
    uid = uuid4().hex
    async with AsyncClient(
        transport=ASGITransport(app=app, client=(f"2001:db8::{uid[:4]}:{uid[4:8]}", 51002)),
        base_url="http://test",
        headers={"Origin": "http://test"},
    ) as other:
        email = f"viewer-{uid}@example.com"
        r = await other.post(
            "/api/v1/auth/register",
            json={"email": email, "password": f"synthetic-{uuid4()}", "device_name": "Viewer"},
        )
        assert r.status_code == 201, r.text
        assert (await other.get(c["path"])).status_code == 404
        async with session_factory() as db:
            owner = await db.scalar(select(User).where(User.email == c["email"]))
            viewer = await db.scalar(select(User).where(User.email == email))
            space = await db.get(Space, UUID(c["sp"]))
            space.visibility = "shared"
            space.owner_user_id = None
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(c["ws"]),
                    user_id=viewer.id,
                    role="viewer",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            # An unrelated private topic can never enter this user's queue, even if
            # a malformed historical schedule was associated with them.
            topic = Topic(
                workspace_id=UUID(c["ws"]),
                space_id=space.id,
                research_owner_id=owner.id,
                title="OTHER_PRIVATE_REVIEW_SENTINEL",
                created_by=owner.id,
                updated_by=owner.id,
            )
            db.add(topic)
            await db.flush()
            db.add_all(
                [
                    ReviewSchedule(
                        workspace_id=UUID(c["ws"]),
                        space_id=space.id,
                        topic_id=topic.id,
                        user_id=viewer.id,
                        status="due",
                        source="manual",
                        interval_days=1,
                        next_review_at=datetime(2026, 1, 1, tzinfo=UTC),
                    ),
                    MasteryRecord(
                        workspace_id=UUID(c["ws"]),
                        space_id=space.id,
                        topic_id=topic.id,
                        user_id=viewer.id,
                        confirmed_by=viewer.id,
                        confirmed_level="familiar",
                        confirmed_at=utc_now(),
                    ),
                ]
            )
            await db.commit()
        listed = await other.get(c["path"])
        assert listed.status_code == 200 and listed.json()["goals"][0]["goal_id"] == goal["goal_id"]
        csrf = {"X-CSRF-Token": other.cookies["logion_csrf"]}
        r = await other.patch(
            f"{c['path']}/{goal['goal_id']}",
            headers=csrf,
            json={"expected_version": 1, "title": "Forbidden"},
        )
        assert r.status_code == 403, r.text
        review = await other.get(c["path"].replace("/goals", "/review-queue"))
        assert review.status_code == 200 and review.json()["items"] == []
        assert "OTHER_PRIVATE_REVIEW_SENTINEL" not in review.text
        async with session_factory() as db:
            member = await db.scalar(
                select(WorkspaceMembership).where(
                    WorkspaceMembership.workspace_id == UUID(c["ws"]),
                    WorkspaceMembership.user_id == viewer.id,
                )
            )
            member.role = "editor"
            await db.commit()
        r = await other.patch(
            f"{c['path']}/{goal['goal_id']}",
            headers=csrf,
            json={"expected_version": 1, "title": "Editor update"},
        )
        assert r.status_code == 200, r.text


async def test_goal_write_rechecks_membership_after_workspace_lock(online_case, monkeypatch):
    c = online_case
    goal = await create(c)
    authorized = asyncio.Event()
    original = PlanningService._resolve_writable_space

    async def observe(self, *args, **kwargs):
        result = await original(self, *args, **kwargs)
        authorized.set()
        return result

    monkeypatch.setattr(PlanningService, "_resolve_writable_space", observe)
    async with session_factory() as db:
        await db.scalar(select(Workspace.id).where(Workspace.id == UUID(c["ws"])).with_for_update())
        pending = asyncio.create_task(
            c["client"].patch(
                f"{c['path']}/{goal['goal_id']}",
                headers=c["csrf"],
                json={"expected_version": 1, "title": "Revoked while waiting"},
            )
        )
        try:
            await asyncio.wait_for(authorized.wait(), timeout=5)
            member = await db.scalar(
                select(WorkspaceMembership).where(WorkspaceMembership.workspace_id == UUID(c["ws"]))
            )
            member.status = "revoked"
            await db.commit()
            response = await asyncio.wait_for(pending, timeout=5)
            assert response.status_code == 404, response.text
        finally:
            if not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    async with session_factory() as db:
        row = await db.get(LearningGoal, UUID(goal["goal_id"]))
        assert row.version == 1 and row.title == "Synthetic goal"
        assert (
            await db.scalar(
                select(func.count()).select_from(SyncChange).where(SyncChange.entity_id == row.id)
            )
            == 1
        )
