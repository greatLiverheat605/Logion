import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0045_research_privacy.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_private_ideas_and_ai_provenance_migration_round_trip() -> None:
    spec = importlib.util.spec_from_file_location("research_privacy_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"privacy_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE spaces (id uuid, workspace_id uuid, PRIMARY KEY(id, workspace_id))"
        )
        connection.exec_driver_sql("CREATE TABLE ai_runs (id uuid PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO ai_runs VALUES (gen_random_uuid())")
        owner, workspace, space = uuid4(), uuid4(), uuid4()
        values = {"owner": owner, "workspace": workspace, "space": space}
        connection.execute(text("INSERT INTO users VALUES (:owner)"), values)
        connection.execute(text("INSERT INTO spaces VALUES (:space, :workspace)"), values)
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.scalar(text("SELECT context_entity_types FROM ai_runs")) == []
            migration.downgrade()
            assert not inspect(connection).has_table("research_ideas")
            assert {column["name"] for column in inspect(connection).get_columns("ai_runs")} == {
                "id"
            }
            migration.upgrade()
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("UPDATE ai_runs SET context_entity_types = '{}'::jsonb")
            with connection.begin_nested() as nested:
                connection.exec_driver_sql(
                    "UPDATE ai_runs SET context_entity_types = '[\"resource\"]'::jsonb"
                )
                with pytest.raises(RuntimeError, match="Preserve"):
                    migration.downgrade()
                nested.rollback()
            connection.execute(
                text("""
                INSERT INTO research_ideas (id, workspace_id, space_id, user_id, title, body,
                  status, version, created_by, updated_by, created_at, updated_at)
                VALUES (gen_random_uuid(), :workspace, :space, :owner, 'Synthetic',
                  'Synthetic private body', 'active', 1, :owner, :owner, now(), now())
            """),
                values,
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("UPDATE research_ideas SET status = 'invalid'")
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql(
                    "UPDATE research_ideas SET workspace_id = gen_random_uuid()"
                )
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            assert (
                connection.scalar(text("SELECT body FROM research_ideas"))
                == "Synthetic private body"
            )

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
