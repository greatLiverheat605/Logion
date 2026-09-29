import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0056_agent_inbox.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_agent_migration_preserves_legacy_notes_and_refuses_populated_downgrade():
    spec = importlib.util.spec_from_file_location("agent_inbox_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"agent_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE spaces (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "UNIQUE (id,workspace_id))"
        )
        connection.exec_driver_sql("""
            CREATE TABLE notes (id uuid PRIMARY KEY, workspace_id uuid, space_id uuid,
              research_owner_id uuid, task_id uuid, note_kind text, resource_id uuid,
              body text, CONSTRAINT ck_note_research_kind CHECK (
                (note_kind IS NULL AND resource_id IS NULL AND research_owner_id IS NULL) OR
                (note_kind='close_reading' AND resource_id IS NOT NULL AND
                 research_owner_id IS NOT NULL AND task_id IS NULL)))
        """)
        ids = {name: uuid4() for name in ("user", "space", "workspace", "token", "item", "note")}
        connection.execute(text("INSERT INTO users VALUES (:user)"), ids)
        connection.execute(text("INSERT INTO spaces VALUES (:space,:workspace)"), ids)
        connection.exec_driver_sql(
            "INSERT INTO notes (id,body) VALUES (gen_random_uuid(),'legacy')"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert not inspect(connection).has_table("agent_tokens")
            assert connection.scalar(text("SELECT body FROM notes")) == "legacy"
            migration.upgrade()
            connection.execute(
                text("""
                INSERT INTO agent_tokens
                  (id,user_id,workspace_id,space_id,name,token_digest,scopes,created_at,expires_at)
                VALUES (:token,:user,:workspace,:space,'synthetic',repeat('0',64),
                  '["read","inbox:write"]',now(),now()+interval '1 day')
            """),
                ids,
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("UPDATE agent_tokens SET scopes='[\"delete\"]'")
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            connection.execute(
                text("""
                INSERT INTO agent_inbox_items
                  (id,token_id,user_id,workspace_id,space_id,submission_key,kind,payload,
                   payload_digest,created_at)
                VALUES (:item,:token,:user,:workspace,:space,'synthetic','report','{}',
                  repeat('0',64),now())
            """),
                ids,
            )
            connection.execute(
                text("""
                INSERT INTO notes
                  (id,workspace_id,space_id,research_owner_id,agent_inbox_item_id,body)
                VALUES (:note,:workspace,:space,:user,:item,'accepted synthetic report')
            """),
                ids,
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text("UPDATE notes SET research_owner_id=NULL WHERE id=:note"), ids
                )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("DELETE FROM agent_tokens")
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM notes")) == 2
            assert connection.scalar(text("SELECT count(*) FROM agent_tokens")) == 1
            assert connection.scalar(text("SELECT count(*) FROM agent_inbox_items")) == 1

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
