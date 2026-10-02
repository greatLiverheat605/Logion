import asyncio
import base64
import importlib.util
import io
import json
import zipfile
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import ASGITransport, AsyncClient
from logion_api.ai_gateway.models import AIOutputDraft, AIRun, AITaskRoute
from logion_api.ai_gateway.research_context import ContextEntity, build_research_context
from logion_api.config import get_settings
from logion_api.db import engine, session_factory, utc_now
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent, AuthSession
from logion_api.main import app
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService
from logion_api.reading.note_template import SECTIONS, TEMPLATE, fill_sections, missing_sections
from logion_api.workspaces.models import WorkspaceMembership
from pycrdt import Doc, Text
from sqlalchemy import Connection, inspect, select, update
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0051_close_reading_notes.py"


def test_template_fills_missing_sections_without_rewriting_owner_text() -> None:
    value = fill_sections(TEMPLATE, {"motivation": "Owner evidence 😀"})
    assert missing_sections(value) == list(SECTIONS)[1:]
    updated = fill_sections(value, {"critique": "Limited sample [source_1]"})
    assert "Owner evidence 😀" in updated and "Limited sample" in updated
    assert (
        fill_sections("Owner preface", {"takeaway": "One sentence"})
        == "Owner preface\n\n## 一句话要点\nOne sentence\n"
    )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_note_yjs_owner_privacy_and_atomic_draft_acceptance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.242", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.243", 49000)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        users = []
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"note-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
            users.append(UUID(response.json()["user"]["id"]))
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
        workspace = (await owner.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
        space = (
            await owner.post(
                f"/api/v1/workspaces/{workspace}/spaces",
                json={"name": "Reading", "visibility": "shared"},
            )
        ).json()["id"]
        scope = f"/api/v1/workspaces/{workspace}/spaces/{space}"
        resource = (
            await owner.post(
                f"{scope}/library/resources",
                json={"title": "Private paper", "resource_type": "paper"},
            )
        ).json()
        path = f"{scope}/library/resources/{resource['id']}/note"
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
        assert (await owner.get(path)).json() is None
        created = await asyncio.gather(owner.post(path), owner.post(path))
        assert [r.status_code for r in created] == [200, 200]
        note = created[0].json()
        assert note == created[1].json()
        assert note["missing_sections"] == list(SECTIONS)
        for client in (owner, peer):
            denied = await client.put(
                f"{scope}/notes/{note['id']}",
                json={"expected_version": 1, "title": "Overwrite", "markdown_body": "private"},
            )
            assert denied.status_code == 404, denied.text
            preview = await client.get(
                f"/api/v1/workspaces/{workspace}/sync/deletion-preview/note/{note['id']}"
            )
            assert preview.status_code == 404, preview.text
        assert (await peer.get(path)).status_code == 404
        assert (await peer.post(path)).status_code == 404
        for headers in ({"Origin": "https://untrusted.example.com"}, {"X-CSRF-Token": "bad"}):
            assert (await owner.post(path, headers=headers)).status_code == 403
        # Independent Yjs clients edit different positions from the same version.
        documents = [Doc({"markdown": Text()}) for _ in range(2)]
        updates = []
        for i, document in enumerate(documents):
            document.apply_update(base64.b64decode(note["yjs_state_base64"]))
            vector = document.get_state()
            text = document["markdown"]
            assert isinstance(text, Text)
            text.insert(
                0 if i == 0 else len(text),
                "Owner private insight 😀\n" if i == 0 else "Owner ending\n",
            )
            updates.append(base64.b64encode(document.get_update(vector)).decode())
        payload = {"space_id": space, "base_version": 1, "yjs_generation": 1}
        results = await asyncio.gather(
            *(
                owner.patch(f"{path}/document", json={**payload, "update_base64": update})
                for update in updates
            )
        )
        assert [r.status_code for r in results] == [200, 200]
        note = (await owner.get(path)).json()
        assert (
            "Owner private insight 😀" in note["markdown_body"]
            and "Owner ending" in note["markdown_body"]
        )
        version = note["version"]
        replay = await owner.patch(
            f"{path}/document", json={**payload, "update_base64": updates[0]}
        )
        assert replay.status_code == 200 and replay.json()["version"] == version
        assert (
            await owner.patch(f"{path}/document", json={**payload, "update_base64": "!!!!"})
        ).status_code == 422
        async with session_factory() as db:
            kwargs = dict(
                workspace_id=UUID(workspace),
                space_id=UUID(space),
                task_type="close_reading",
                entities=[ContextEntity(entity_type="note", id=UUID(note["id"]), version=version)],
            )
            assert (
                "Owner private insight"
                in (await build_research_context(db, user_id=users[0], **kwargs))["source_0"]
            )
            with pytest.raises(APIError):
                await build_research_context(db, user_id=users[1], **kwargs)
            for user in users:
                archive = await object.__new__(PortabilityService)._build_archive(
                    db, DataExportJob(workspace_id=UUID(workspace), requested_by=user)
                )
                with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
                    data = json.loads(bundle.read("data.json"))
                assert note["id"] not in json.dumps(data) and "note_kind" not in json.dumps(data)
            route = AITaskRoute(
                workspace_id=UUID(workspace),
                name="synthetic-note",
                normalized_name="synthetic-note",
                task_type="close_reading",
                max_input_tokens=16000,
                max_output_tokens=2000,
                created_by=users[0],
                updated_by=users[0],
            )
            db.add(route)
            await db.flush()
            route_id = route.id
            await db.commit()

        async def seed_draft(target_version: int, output: dict[str, str]) -> UUID:
            async with session_factory() as db:
                run = AIRun(
                    workspace_id=UUID(workspace),
                    route_id=route_id,
                    task_type="close_reading",
                    target_type="note",
                    target_id=UUID(note["id"]),
                    target_version=target_version,
                    selected_fields=["source_0"],
                    context_entity_types=["note"],
                    expected_output_fields=list(output),
                    prompt_version="research-v1/close_reading",
                    prompt_hash="0" * 64,
                    idempotency_key=uuid4(),
                    request_hash="0" * 64,
                    status="succeeded",
                    estimated_input_tokens=1,
                    requested_output_tokens=1,
                    reserved_tokens=2,
                    reserved_cost_minor=0,
                    currency="USD",
                    requested_by=users[0],
                )
                db.add(run)
                await db.flush()
                draft = AIOutputDraft(
                    workspace_id=UUID(workspace),
                    run_id=run.id,
                    target_type="note",
                    target_id=UUID(note["id"]),
                    target_version=target_version,
                    structured_output=output,
                )
                db.add(draft)
                await db.flush()
                identity = draft.id
                await db.commit()
                return identity

        draft_id = await seed_draft(version, {"motivation": "Drafted motivation [source_0]"})
        assert "Drafted motivation" not in (await owner.get(path)).text
        assert (await peer.get(f"{path}/ai-runs")).status_code == 404
        assert len((await owner.get(f"{path}/ai-runs")).json()["runs"]) == 1
        decision = {
            "decision": "accepted",
            "expected_note_version": version,
            "expected_draft_version": 1,
        }
        assert (
            await peer.post(f"{path}/drafts/{draft_id}/decision", json=decision)
        ).status_code == 404
        for headers in ({"Origin": "https://untrusted.example.com"}, {"X-CSRF-Token": "bad"}):
            assert (
                await owner.post(
                    f"{path}/drafts/{draft_id}/decision", json=decision, headers=headers
                )
            ).status_code == 403
        async with session_factory() as db:
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users[0])
                .values(created_at=utc_now() - timedelta(hours=1))
            )
            await db.commit()
        # ADR-0066: accepting a research draft works throughout a long reading session.
        accepted = await owner.post(f"{path}/drafts/{draft_id}/decision", json=decision)
        async with session_factory() as db:
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == users[0])
                .values(created_at=utc_now())
            )
            await db.commit()
        assert accepted.status_code == 200, accepted.text
        assert "Drafted motivation" in accepted.json()["markdown_body"]
        assert "Owner private insight" in accepted.json()["markdown_body"]
        assert accepted.json()["yjs_generation"] == 2
        assert (
            await owner.post(f"{path}/drafts/{draft_id}/decision", json=decision)
        ).status_code == 409
        assert (
            await owner.patch(f"{path}/document", json={**payload, "update_base64": updates[0]})
        ).status_code == 409
        stale = await seed_draft(version, {"modeling": "Stale draft"})
        assert (
            await owner.post(
                f"{path}/drafts/{stale}/decision",
                json={**decision, "expected_note_version": version + 1},
            )
        ).status_code == 409
        async with session_factory() as db:
            row = await db.get(AIOutputDraft, stale)
            assert row and row.status == "pending"
        assert (
            await owner.post(
                f"{path}/drafts/{stale}/decision", json={**decision, "decision": "rejected"}
            )
        ).status_code == 200
        invalid = await seed_draft(version + 1, {"motivation": "Overwrite owner section"})
        assert (
            await owner.post(
                f"{path}/drafts/{invalid}/decision",
                json={**decision, "expected_note_version": version + 1},
            )
        ).status_code == 422
        for client in (owner, peer):
            search = await client.post(
                f"/api/v1/workspaces/{workspace}/search", json={"query": "private insight"}
            )
            assert search.status_code == 200 and note["id"] not in search.text
            devices = (await client.get("/api/v1/auth/devices")).json()["devices"]
            bootstrap = await client.post(
                f"/api/v1/workspaces/{workspace}/sync/bootstrap",
                json={
                    "message_type": "bootstrap_request",
                    "protocol_version": "sync-v1",
                    "workspace_id": workspace,
                    "device_id": next(d["id"] for d in devices if d["current"]),
                    "known_sync_epoch": None,
                    "snapshot_id": None,
                    "chunk_index": None,
                },
            )
            assert bootstrap.status_code == 200 and note["id"] not in bootstrap.text
        async with session_factory() as db:
            events = list(
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == users[0],
                        AuditEvent.event_type.like("library.reading_note%"),
                    )
                )
            )
            assert events and all(e.workspace_id is None and e.target_id is None for e in events)
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(path)).status_code == 404
        assert (await owner.post(path)).status_code == 404
        assert (await owner.get(f"{path}/ai-runs")).status_code == 404
        assert (
            await owner.post(f"{path}/drafts/{invalid}/decision", json=decision)
        ).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_note_migration_roundtrip_scope_constraint_and_data_refusal() -> None:
    spec = importlib.util.spec_from_file_location("reading_note_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"note_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE resources (id uuid, workspace_id uuid, space_id uuid, "
            "research_owner_id uuid, UNIQUE(id,workspace_id,space_id,research_owner_id))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE notes (id uuid PRIMARY KEY, workspace_id uuid, "
            "space_id uuid, task_id uuid)"
        )
        connection.exec_driver_sql(
            "INSERT INTO notes VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),NULL)"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert "note_kind" not in {c["name"] for c in inspect(connection).get_columns("notes")}
            migration.upgrade()
            connection.exec_driver_sql("INSERT INTO users VALUES (gen_random_uuid())")
            connection.exec_driver_sql(
                "INSERT INTO resources SELECT gen_random_uuid(),workspace_id,space_id,"
                "(SELECT id FROM users) FROM notes"
            )
            connection.exec_driver_sql(
                "UPDATE notes SET note_kind='close_reading',resource_id=(SELECT id FROM resources),"
                "research_owner_id=(SELECT id FROM users)"
            )
            for invalid in (
                "UPDATE notes SET note_kind=NULL",
                "UPDATE notes SET space_id=gen_random_uuid()",
                "UPDATE notes SET task_id=gen_random_uuid()",
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
