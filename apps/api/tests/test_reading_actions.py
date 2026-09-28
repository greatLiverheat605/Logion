import asyncio
import importlib.util
import io
import json
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.research_context import ContextEntity, build_research_context
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import engine, session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent
from logion_api.knowledge_space.models import KnowledgeCitation
from logion_api.main import app
from logion_api.memory.models import Topic
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import ValidationError
from sqlalchemy import Connection, inspect, select

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations/versions/0050_private_reading_topics.py"
)


def test_selection_context_requires_complete_source_text_range() -> None:
    for extra in [
        dict(char_start=0),
        dict(char_end=2),
        dict(char_start=2, char_end=1),
        dict(char_start=-1, char_end=1),
    ]:
        with pytest.raises(ValidationError):
            ContextEntity(entity_type="source_text", id=uuid4(), version=1, **extra)
    for kind in ("resource", "note", "topic", "research_idea"):
        with pytest.raises(ValidationError):
            ContextEntity(entity_type=kind, id=uuid4(), version=1, char_start=0, char_end=2)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_reading_actions_scope_positions_idempotency_and_legacy_privacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.240", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.241", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"reading-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        created = await owner.post(
            f"/api/v1/workspaces/{workspace}/spaces",
            json={"name": "Shared reading", "visibility": "shared"},
        )
        assert created.status_code == 201, created.text
        space = created.json()["id"]
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        resource = (
            await owner.post(
                f"{scope}/library/resources",
                json={"title": "Synthetic reading", "resource_type": "paper"},
            )
        ).json()
        path = f"{scope}/library/resources/{resource['id']}"
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
            row = await db.get(Resource, UUID(resource["id"]))
            assert row
            row.sha256 = "a" * 64
            await db.commit()
        response = await owner.post(
            f"{path}/text",
            json={
                "file_sha256": "a" * 64,
                "pages": ["e\u0301😀 first", "second page"],
                "extracted_by": "pdfjs@6.3.289",
            },
        )
        assert response.status_code == 200, response.text
        source = response.json()
        selection = {"source_text_id": source["id"], "char_start": 0, "char_end": 12}
        results = await asyncio.gather(
            *(owner.post(f"{path}/excerpts", json=selection) for _ in range(2))
        )
        assert [result.status_code for result in results] == [201, 201]
        excerpt = results[0].json()
        assert excerpt["id"] == results[1].json()["id"]
        assert excerpt["excerpt_text"] == "é😀 first\nsec"
        assert (excerpt["page_start"], excerpt["page_end"]) == (1, 2)
        assert excerpt["origin"] == "logion"
        concepts = await asyncio.gather(
            *(owner.post(f"{path}/concepts", json=selection) for _ in range(2))
        )
        assert [result.status_code for result in concepts] == [201, 201]
        concept = concepts[0].json()
        assert concept == concepts[1].json()
        topic_id = concept["topic_id"]
        assert concept["excerpt"]["id"] == excerpt["id"]
        for suffix in ("excerpts", "concepts"):
            assert (await peer.post(f"{path}/{suffix}", json=selection)).status_code == 404
            for headers in (
                {"X-CSRF-Token": "invalid"},
                {"Origin": "https://untrusted.example.com"},
            ):
                assert (
                    await owner.post(f"{path}/{suffix}", json=selection, headers=headers)
                ).status_code == 403
        assert (await peer.get(f"{path}/excerpts")).status_code == 404
        for start, end in ((1, 1), (0, 900000), (8, 9)):
            assert (
                await owner.post(
                    f"{path}/excerpts", json={**selection, "char_start": start, "char_end": end}
                )
            ).status_code == 422
        async with session_factory() as db:
            topic = await db.get(Topic, UUID(topic_id))
            citation = await db.get(KnowledgeCitation, UUID(concept["citation_id"]))
            assert topic and topic.research_owner_id == users[0]
            assert (
                citation
                and citation.topic_id == topic.id
                and citation.source_excerpt_id == UUID(excerpt["id"])
            )
            ref = ContextEntity(
                entity_type="source_text",
                id=UUID(source["id"]),
                version=1,
                char_start=0,
                char_end=2,
            )
            kwargs = dict(
                workspace_id=UUID(workspace),
                space_id=UUID(space),
                task_type="translate",
                entities=[ref],
            )
            fields = await build_research_context(db, user_id=users[0], **kwargs)
            assert json.loads(fields["source_0"])["data"]["text"] == "é😀"
            assert "second" not in fields["source_0"]
            with pytest.raises(APIError):
                await build_research_context(db, user_id=users[1], **kwargs)
            for user in users:
                archive = await object.__new__(PortabilityService)._build_archive(
                    db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
                )
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    data = json.loads(bundle.read("data.json"))
                assert topic_id not in json.dumps(data)
                assert "research_owner_id" not in json.dumps(data)
            audit = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == users[0],
                        AuditEvent.event_type.in_(
                            ["library.excerpt_created", "library.concept_created"]
                        ),
                    )
                )
            )
            assert audit and all(
                item.workspace_id is None and item.target_id is None for item in audit
            )
        for client in (owner, peer):
            topics = await client.get(f"{scope}/topics")
            assert topics.status_code == 200, topics.text
            assert topic_id not in topics.text
            preview = await client.get(
                f"/api/v1/workspaces/{workspace}/sync/deletion-preview/topic/{topic_id}"
            )
            assert preview.status_code == 404, preview.text
            search = await client.post(
                f"/api/v1/workspaces/{workspace}/search", json={"query": "first"}
            )
            assert search.status_code == 200, search.text
            assert topic_id not in search.text
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            device_id = next(item["id"] for item in devices if item["current"])
            bootstrap = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                json={
                    "message_type": "bootstrap_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": device_id,
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200, bootstrap.text
            assert topic_id not in bootstrap.text
            changed = await client.put(
                f"{scope}/topics/{topic_id}",
                json={
                    "id": topic_id,
                    "title": "Overwrite",
                    "description": "",
                    "expected_version": 1,
                },
            )
            assert changed.status_code == 404, changed.text
        async with session_factory() as db:
            row = await db.get(Resource, UUID(resource["id"]))
            assert row
            row.sha256 = "b" * 64
            await db.commit()
        assert (await owner.post(f"{path}/excerpts", json=selection)).status_code == 409
        assert (await owner.post(f"{path}/concepts", json=selection)).status_code == 409
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(f"{path}/excerpts")).status_code == 404
        assert (await owner.post(f"{path}/excerpts", json=selection)).status_code == 404
        assert (await owner.post(f"{path}/concepts", json=selection)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_topic_migration_preserves_old_rows_and_refuses_private_data() -> None:
    spec = importlib.util.spec_from_file_location("topic_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"topic_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE topics (id uuid PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO topics VALUES (gen_random_uuid())")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert "research_owner_id" not in {
                column["name"] for column in inspect(connection).get_columns("topics")
            }
            migration.upgrade()
            connection.exec_driver_sql("INSERT INTO users VALUES (gen_random_uuid())")
            connection.exec_driver_sql(
                "UPDATE topics SET research_owner_id=(SELECT id FROM users LIMIT 1)"
            )
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
