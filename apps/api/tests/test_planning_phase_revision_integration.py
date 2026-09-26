from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import session_factory
from logion_api.execution.models import Task
from logion_api.identity.models import AuditEvent, User
from logion_api.main import app
from logion_api.planning.models import LearningGoal, LearningPlan, PlanPhase, PlanVersion
from logion_api.sync.models import SyncChange
from logion_api.sync.push import canonical_hash
from sqlalchemy import select

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


def phase(identifier, title, *, archived=False, removed=False):
    return {
        "id": str(identifier),
        "title": title,
        "description": "",
        "estimated_minutes": 30,
        "acceptance_criteria": [f"{title} proof"],
        "archived": archived,
        "removed": removed,
    }


@pytest_asyncio.fixture(loop_scope="session")
async def revision_case():
    address = uuid4().hex
    client_ip = f"2001:db8::{address[:4]}:{address[4:8]}"
    original_overrides = dict(app.dependency_overrides)
    enabled = {"value": True}
    base_settings = get_settings()

    def settings():
        return base_settings.model_copy(
            update={"planning_phase_revision_enabled": enabled["value"]}
        )

    app.dependency_overrides[get_settings] = settings
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app, client=(client_ip, 54006)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as client:
            email = f"phase-{uuid4()}@example.com"
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": f"phase-test-{uuid4()}",
                    "device_name": "Phase A",
                },
            )
            assert registered.status_code == 201, registered.text
            workspace = (await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            space = (await client.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"][
                0
            ]["id"]
            device = next(
                item["id"]
                for item in (await client.get("/api/v1/auth/devices")).json()["devices"]
                if item["current"]
            )
            envelope = {
                "protocol_version": "sync-v1",
                "workspace_id": workspace,
                "device_id": device,
            }
            bootstrap = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                json={
                    **envelope,
                    "message_type": "bootstrap_request",
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200, bootstrap.text
            epoch = bootstrap.json()["sync_epoch"]
            goal_id, first, second = uuid4(), uuid4(), uuid4()

            def operation(payload, *, operation_type="update", base=1, operation_id=None):
                body = {"space_id": space, **payload}
                return {
                    **envelope,
                    "operation_id": str(operation_id or uuid4()),
                    "entity_type": "learning_goal",
                    "entity_id": str(goal_id),
                    "operation_type": operation_type,
                    "base_version": base,
                    "client_occurred_at": datetime.now(UTC).isoformat(),
                    "payload": body,
                    "payload_hash": canonical_hash(body),
                    "dependencies": [],
                }

            async def push(op):
                response = await client.post(
                    f"/api/v1/workspaces/{workspace}/sync/push",
                    headers={"X-CSRF-Token": client.cookies["logion_csrf"]},
                    json={
                        **envelope,
                        "message_type": "push_request",
                        "sync_epoch": epoch,
                        "operations": [op],
                    },
                )
                assert response.status_code == 200, response.text
                return response.json()["results"][0]

            created = await push(
                operation(
                    {
                        "plan_id": str(uuid4()),
                        "plan_version_id": str(uuid4()),
                        "title": "Revise my route",
                        "description": "",
                        "desired_outcome": "A verified artifact",
                        "weekly_minutes": 120,
                        "target_date": None,
                        "phases": [
                            {
                                "id": str(identifier),
                                "title": title,
                                "description": "",
                                "position": position,
                                "estimated_minutes": 30,
                                "acceptance_criteria": [f"{title} proof"],
                            }
                            for position, (identifier, title) in enumerate(
                                [(first, "First"), (second, "Second")]
                            )
                        ],
                    },
                    operation_type="create",
                    base=0,
                )
            )
            assert created["status"] == "applied", created
            yield {
                "client": client,
                "workspace": workspace,
                "space": space,
                "goal_id": goal_id,
                "first": first,
                "second": second,
                "operation": operation,
                "push": push,
                "enabled": enabled,
                "email": email,
            }
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(original_overrides)


async def phases_of(goal_id):
    async with session_factory() as db:
        goal = await db.get(LearningGoal, goal_id)

        plan = await db.scalar(select(LearningPlan).where(LearningPlan.goal_id == goal_id))
        version = await db.scalar(
            select(PlanVersion)
            .where(PlanVersion.plan_id == plan.id)
            .order_by(PlanVersion.version_number.desc())
        )
        rows = (
            await db.scalars(
                select(PlanPhase)
                .where(PlanPhase.plan_version_id == version.id)
                .order_by(PlanPhase.position)
            )
        ).all()
        return goal.version, [(row.id, row.title, row.archived_at is not None) for row in rows]


async def test_flag_off_rejects_revision_and_reports_capability(revision_case):
    case = revision_case
    case["enabled"]["value"] = False
    capability = await case["client"].get(
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/goals/capabilities"
    )
    assert capability.status_code == 200, capability.text
    assert capability.json() == {"phase_revision_enabled": False}
    result = await case["push"](
        case["operation"]({"phases": [phase(case["first"], "First"), phase(case["second"], "B")]})
    )
    assert result["status"] == "rejected"
    assert result["error_code"] == "SYNC_OPERATION_FORBIDDEN"
    assert (await phases_of(case["goal_id"]))[0] == 1


async def test_append_edit_reorder_and_archive(revision_case):
    case = revision_case
    capability = await case["client"].get(
        f"/api/v1/workspaces/{case['workspace']}/spaces/{case['space']}/goals/capabilities"
    )
    assert capability.json() == {"phase_revision_enabled": True}
    third = uuid4()
    op = case["operation"](
        {
            "phases": [
                phase(third, "Third"),
                phase(case["second"], "Second edited"),
                phase(case["first"], "First", archived=True),
            ]
        }
    )
    result = await case["push"](op)
    assert result["status"] == "applied", result
    assert result["server_version"] == 2
    version, rows = await phases_of(case["goal_id"])
    assert version == 2
    assert rows == [
        (third, "Third", False),
        (case["second"], "Second edited", False),
        (case["first"], "First", True),
    ]
    replay = await case["push"](op)
    assert replay["status"] == "duplicate"
    async with session_factory() as db:
        change = await db.scalar(
            select(SyncChange)
            .where(SyncChange.entity_id == case["goal_id"])
            .order_by(SyncChange.sequence.desc())
        )
        payload = change.payload
        assert [item["archived_at"] is not None for item in payload["phases"]] == [
            False,
            False,
            True,
        ]
        user = await db.scalar(select(User).where(User.email == case["email"]))
        audit = await db.scalar(
            select(AuditEvent)
            .where(
                AuditEvent.actor_id == user.id,
                AuditEvent.event_type == "planning.phase_revised",
            )
            .order_by(AuditEvent.occurred_at.desc())
        )
        assert audit.event_metadata == {
            "space_id": case["space"],
            "added": 1,
            "updated": 2,
            "archived": 1,
            "removed": 0,
        }


async def test_referenced_phase_cannot_be_removed_but_unreferenced_can(revision_case):
    case = revision_case
    async with session_factory() as db:
        user = await db.scalar(select(User).where(User.email == case["email"]))
        db.add(
            Task(
                goal_id=case["goal_id"],
                phase_id=case["first"],
                title="Uses the first phase",
                workspace_id=UUID(case["workspace"]),
                space_id=UUID(case["space"]),
                created_by=user.id,
                updated_by=user.id,
            )
        )
        await db.commit()
    blocked = await case["push"](
        case["operation"](
            {
                "phases": [
                    phase(case["first"], "First", removed=True),
                    phase(case["second"], "Second"),
                ]
            }
        )
    )
    assert blocked["status"] == "rejected"
    assert blocked["error_code"] == "SYNC_OPERATION_FORBIDDEN"
    assert len((await phases_of(case["goal_id"]))[1]) == 2
    removed = await case["push"](
        case["operation"](
            {
                "phases": [
                    phase(case["first"], "First"),
                    phase(case["second"], "Second", removed=True),
                ]
            }
        )
    )
    assert removed["status"] == "applied", removed
    assert [row[0] for row in (await phases_of(case["goal_id"]))[1]] == [case["first"]]


@pytest.mark.parametrize(
    "phases_factory",
    [
        lambda case: [phase(case["first"], "Only first")],
        lambda case: [
            phase(case["first"], "First", archived=True),
            phase(case["second"], "Second", archived=True),
        ],
    ],
    ids=["missing-existing-phase", "no-active-phase"],
)
async def test_invalid_revisions_change_nothing(revision_case, phases_factory):
    case = revision_case
    result = await case["push"](case["operation"]({"phases": phases_factory(case)}))
    assert result["status"] == "rejected"
    assert result["error_code"] == "SYNC_OPERATION_INVALID"
    assert (await phases_of(case["goal_id"]))[0] == 1


async def test_full_goal_payload_revises_only_phases(revision_case):
    case = revision_case
    result = await case["push"](
        case["operation"](
            {
                "title": "Ignored title change",
                "plan_id": str(uuid4()),
                "phases": [
                    {**phase(case["second"], "Second"), "position": 0, "archived_at": None},
                    {**phase(case["first"], "First"), "position": 1, "archived_at": None},
                ],
            }
        )
    )
    assert result["status"] == "applied", result
    async with session_factory() as db:
        goal = await db.get(LearningGoal, case["goal_id"])
        assert goal.title == "Revise my route"
    assert [row[0] for row in (await phases_of(case["goal_id"]))[1]] == [
        case["second"],
        case["first"],
    ]


async def test_stale_base_version_is_a_conflict(revision_case):
    case = revision_case
    first = await case["push"](
        case["operation"]({"phases": [phase(case["first"], "A"), phase(case["second"], "B")]})
    )
    assert first["status"] == "applied"
    stale = await case["push"](
        case["operation"]({"phases": [phase(case["first"], "C"), phase(case["second"], "D")]})
    )
    assert stale["status"] == "conflict", stale
    assert (await phases_of(case["goal_id"]))[1][0][1] == "A"
