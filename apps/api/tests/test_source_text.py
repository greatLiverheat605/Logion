import asyncio
import importlib.util
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
from logion_api.library.text_routes import SourceTextCreate
from logion_api.main import app
from logion_api.workspaces.models import WorkspaceMembership
from pydantic import ValidationError
from sqlalchemy import Connection, inspect

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations/versions/0049_source_texts_source_texts.py"
)


def test_source_text_normalization_and_limits() -> None:
    payload = dict(file_sha256="a" * 64, extracted_by="pdfjs@6.3.289")
    assert SourceTextCreate(**payload, pages=["e\u0301\r\n\U0001f600\r"]).pages == ["é\n😀\n"]
    for pages in [["\x00"], ["a" * 500000] * 11, ["\u0344" * 400000] * 4]:
        with pytest.raises(ValidationError):
            SourceTextCreate(**payload, pages=pages)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_source_text_owner_scope_file_binding_and_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.230", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.231", 49001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"text-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
            users.append(UUID(registered.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = UUID((await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"])
        space = UUID(
            (
                await owner.post(
                    f"/api/v1/workspaces/{workspace}/spaces",
                    json={"name": "Shared reader test", "visibility": "shared"},
                )
            ).json()["id"]
        )
        base = f"/api/v1/workspaces/{workspace}/spaces/{space}/library/resources"
        resource = (
            await owner.post(base, json={"title": "Synthetic full text", "resource_type": "paper"})
        ).json()
        resource_id = UUID(resource["id"])
        path = f"{base}/{resource_id}/text"
        async with session_factory() as db:
            db.add(
                WorkspaceMembership(
                    workspace_id=workspace,
                    user_id=users[1],
                    role="admin",
                    status="active",
                    joined_at=utc_now(),
                )
            )
            row = await db.get(Resource, resource_id)
            assert row
            row.sha256 = "a" * 64
            await db.commit()
        assert (await owner.get(path)).status_code == 404
        payload = {
            "file_sha256": "a" * 64,
            "pages": ["e\u0301\r\n😀", "Second page"],
            "extracted_by": "pdfjs@6.3.289",
        }
        for headers in [{"Origin": "https://untrusted.example.com"}, {"X-CSRF-Token": "invalid"}]:
            assert (await owner.post(path, json=payload, headers=headers)).status_code == 403
        assert (await peer.post(path, json=payload)).status_code == 404
        assert (
            await owner.post(path, json={**payload, "file_sha256": "b" * 64})
        ).status_code == 409
        results = await asyncio.gather(
            owner.post(path, json=payload), owner.post(path, json=payload)
        )
        assert [r.status_code for r in results] == [200, 200]
        text = results[0].json()
        assert text["id"] == results[1].json()["id"]
        assert text["text"] == "é\n😀\nSecond page\n"
        assert text["page_offsets"] == [{"start": 0, "end": 4}, {"start": 4, "end": 16}]
        assert (await owner.get(path)).json() == text
        assert (await peer.get(path)).status_code == 404
        ref = ContextEntity(entity_type="source_text", id=UUID(text["id"]), version=1)
        kwargs = dict(workspace_id=workspace, space_id=space, task_type="explain", entities=[ref])
        async with session_factory() as db:
            assert (
                "Second page"
                in (await build_research_context(db, user_id=users[0], **kwargs))["source_0"]
            )
            with pytest.raises(APIError, match="Context source not found"):
                await build_research_context(db, user_id=users[1], **kwargs)
            row = await db.get(Resource, resource_id)
            assert row
            row.sha256 = "b" * 64
            await db.commit()
        assert (await owner.get(path)).status_code == 404
        assert (await owner.post(path, json=payload)).status_code == 409
        async with session_factory() as db:
            with pytest.raises(APIError, match="Context source not found"):
                await build_research_context(db, user_id=users[0], **kwargs)
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(path)).status_code == 404
        assert (await owner.post(path, json=payload)).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_source_text_migration_roundtrip_refuses_user_data() -> None:
    spec = importlib.util.spec_from_file_location("text_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"text_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql(
            "CREATE TABLE resources (id uuid, workspace_id uuid, space_id uuid, "
            "PRIMARY KEY(id,workspace_id,space_id))"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert not inspect(connection).has_table("source_texts")
            migration.upgrade()
            connection.exec_driver_sql(
                "INSERT INTO resources VALUES "
                "(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())"
            )
            connection.exec_driver_sql(
                "INSERT INTO source_texts SELECT gen_random_uuid(),id,workspace_id,space_id,"
                "repeat('a',64),'Synthetic text','[]','pdfjs@6.3.289','utf8-nfc-lf-v1',"
                "1,CURRENT_TIMESTAMP,NULL FROM resources"
            )
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
