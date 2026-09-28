import asyncio
import importlib.util
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.db import engine, session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent
from logion_api.main import app
from logion_api.research.questions import validate_tree
from logion_api.workspaces.models import WorkspaceMembership
from sqlalchemy import Connection, inspect, select
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0053_question_tree.py"


def test_hierarchy_rejects_cycles_missing_parents_and_excessive_depth() -> None:
    identities = [uuid4() for _ in range(33)]
    tree = {identity: identities[i - 1] if i else None for i, identity in enumerate(identities)}
    validate_tree(dict(list(tree.items())[:32]))
    for invalid in (
        tree,
        {identities[0]: identities[1]},
        {identities[0]: identities[1], identities[1]: identities[0]},
    ):
        with pytest.raises(APIError, match="hierarchy"):
            validate_tree(invalid)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_question_tree_atomic_grouping_and_version_boundaries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.250", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.251", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"question-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
            users.append(UUID(registered.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        spaces = []
        for name in ("Questions", "Another scope"):
            result = await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={"name": name, "visibility": "shared"},
            )
            assert result.status_code == 201
            spaces.append(result.json()["id"])
        scope = f"/api/v1/workspaces/{workspace}/spaces/{spaces[0]}"
        path = scope + "/research/question-tree"
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=UUID(workspace),
                    user_id=users[1],
                    role="admin",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            await db.commit()
        # Existing /research contract and records remain readable through both clients.
        legacy_id = str(uuid4())
        legacy = await owner.post(
            scope + "/research/questions",
            json={
                "id": legacy_id,
                "question": "Original question",
                "rationale": "Original rationale",
            },
        )
        assert legacy.status_code == 201
        assert set(legacy.json()) == {"id", "question", "rationale", "version"}
        original = (await owner.get(path + "/" + legacy_id)).json()
        assert original["status"] == "active" and original["parent_id"] is None
        for headers in ({"X-CSRF-Token": "invalid"}, {"Origin": "https://untrusted.example.com"}):
            assert (
                await owner.post(path, json={"question": "Denied"}, headers=headers)
            ).status_code == 403
        other = (
            await owner.post(
                path, json={"question": "Independent question", "rationale": "Keep this too"}
            )
        ).json()
        assert (await peer.get(path)).json()["questions"] == []
        assert (await peer.get(path + "/" + legacy_id)).status_code == 404
        assert (
            await peer.post(path, json={"question": "Cross owner", "parent_id": legacy_id})
        ).status_code == 404
        wrong_space = path.replace(spaces[0], spaces[1])
        assert (
            await owner.post(wrong_space, json={"question": "Cross space", "parent_id": legacy_id})
        ).status_code == 404
        split_payload = {
            "expected_version": 1,
            "children": [
                {"question": "Modeling subquestion"},
                {"question": "Experiment subquestion"},
            ],
        }
        assert (
            await peer.post(path + "/" + legacy_id + "/split", json=split_payload)
        ).status_code == 404
        split = await owner.post(path + "/" + legacy_id + "/split", json=split_payload)
        assert split.status_code == 200, split.text
        original, child, sibling = split.json()["questions"]
        assert (
            original["question"] == "Original question"
            and original["rationale"] == "Original rationale"
        )
        assert child["parent_id"] == sibling["parent_id"] == legacy_id
        assert (
            await owner.post(path + "/" + legacy_id + "/split", json=split_payload)
        ).status_code == 409
        update = {
            "question": original["question"],
            "rationale": original["rationale"],
            "status": "answered",
            "expected_version": original["version"],
            "parent_id": child["id"],
        }
        assert (await owner.put(path + "/" + legacy_id, json=update)).json()[
            "code"
        ] == "QUESTION_TREE_INVALID"
        update["parent_id"] = None
        concurrent = await asyncio.gather(
            *[owner.put(path + "/" + legacy_id, json=update) for _ in range(2)]
        )
        assert sorted(item.status_code for item in concurrent) == [200, 409]
        original = (await owner.get(path + "/" + legacy_id)).json()
        assert original["status"] == "answered"
        merge_payload = {
            "question": "Combined research direction",
            "sources": [
                {"id": original["id"], "expected_version": original["version"]},
                {"id": child["id"], "expected_version": child["version"]},
            ],
        }
        assert (await owner.post(path + "/merge", json=merge_payload)).json()[
            "code"
        ] == "QUESTION_MERGE_OVERLAP"
        merge_payload["sources"][1] = {"id": other["id"], "expected_version": other["version"]}
        assert (await peer.post(path + "/merge", json=merge_payload)).status_code == 404
        monkeypatch.setattr(settings, "research_entity_per_user_quota", 4)
        assert (await owner.post(path + "/merge", json=merge_payload)).json()[
            "code"
        ] == "RESOURCE_QUOTA_EXCEEDED"
        assert (await owner.get(path + "/" + legacy_id)).json()["parent_id"] is None
        monkeypatch.setattr(settings, "research_entity_per_user_quota", 10000)
        merged = await owner.post(path + "/merge", json=merge_payload)
        assert merged.status_code == 201, merged.text
        root = merged.json()
        for source in (original, other):
            current = (await owner.get(path + "/" + source["id"])).json()
            assert current["parent_id"] == root["id"]
            assert all(current[key] == source[key] for key in ("question", "rationale", "status"))
        assert (await owner.get(path + "/" + child["id"])).json()["parent_id"] == original["id"]
        assert (await owner.post(path + "/merge", json=merge_payload)).status_code == 409
        # Cursor reads return each record once, while GETs leave versions untouched.
        found: list[str] = []
        cursor = None
        while True:
            page = (
                await owner.get(path, params={"limit": 2, **({"cursor": cursor} if cursor else {})})
            ).json()
            found += [item["id"] for item in page["questions"]]
            cursor = page["next_cursor"]
            if cursor is None:
                break
        assert len(found) == len(set(found)) == 5
        assert (await owner.get(path + "/" + root["id"])).json()["version"] == root["version"]
        async with session_factory() as db:
            events = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == users[0],
                        AuditEvent.event_type.like("research.question_%"),
                    )
                )
            )
            assert events and all(
                e.workspace_id is None and e.target_id is None and not e.event_metadata
                for e in events
            )
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        for method, suffix, body in (
            ("get", "", None),
            ("get", "/" + legacy_id, None),
            ("post", "", {"question": "Disabled"}),
            ("put", "/" + legacy_id, update),
            ("post", "/" + legacy_id + "/split", split_payload),
            ("post", "/merge", merge_payload),
        ):
            assert (
                await owner.request(
                    method, path + suffix, **({"json": body} if body is not None else {})
                )
            ).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_question_migration_scope_and_user_data_refusal() -> None:
    spec = importlib.util.spec_from_file_location("question_tree_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"question_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql(
            "CREATE TABLE research_questions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "space_id uuid NOT NULL, user_id uuid NOT NULL, question text NOT NULL, "
            "UNIQUE(id,workspace_id,space_id,user_id))"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert "status" not in {
                item["name"] for item in inspect(connection).get_columns("research_questions")
            }
            connection.exec_driver_sql(
                "INSERT INTO research_questions VALUES(gen_random_uuid(),gen_random_uuid(),"
                "gen_random_uuid(),gen_random_uuid(),'Preserved original')"
            )
            migration.upgrade()
            assert connection.exec_driver_sql(
                "SELECT status, parent_id, question FROM research_questions"
            ).one() == ("active", None, "Preserved original")
            for invalid in (
                "UPDATE research_questions SET parent_id=id",
                "UPDATE research_questions SET status='unknown'",
                "INSERT INTO research_questions SELECT gen_random_uuid(),workspace_id,space_id,"
                "gen_random_uuid(),'Cross owner','active',id FROM research_questions",
                "INSERT INTO research_questions SELECT gen_random_uuid(),workspace_id,"
                "gen_random_uuid(),user_id,'Cross space','active',id FROM research_questions",
            ):
                with connection.begin_nested() as nested:
                    with pytest.raises(IntegrityError):
                        connection.exec_driver_sql(invalid)
                    nested.rollback()
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
