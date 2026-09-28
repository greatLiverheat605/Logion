import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0047_zotero_sync.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_zotero_migration_roundtrip_constraints_and_data_refusal() -> None:
    spec = importlib.util.spec_from_file_location("zotero_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"zotero_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE integration_credentials (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE spaces (id uuid, workspace_id uuid, UNIQUE(id,workspace_id))"
        )
        connection.exec_driver_sql("CREATE TABLE resources (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE source_excerpts (id uuid PRIMARY KEY, resource_id uuid)"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert not inspect(connection).has_table("zotero_sync_states")
            migration.upgrade()
            connection.exec_driver_sql(
                "INSERT INTO resources VALUES (gen_random_uuid(), false, '[]')"
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("UPDATE resources SET zotero_collection_keys='{}'")
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql(
                    "INSERT INTO source_excerpts (id,origin) VALUES (gen_random_uuid(),'zotero')"
                )
            connection.exec_driver_sql("UPDATE resources SET zotero_sync_stopped=true")
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM resources")) == 1
            assert inspect(connection).has_table("zotero_sync_states")

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
