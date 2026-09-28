import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0048_pdf_cache.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pdf_migration_roundtrip_and_refuse_data_loss() -> None:
    spec = importlib.util.spec_from_file_location("pdf_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"pdf_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        for table in ("resources", "users", "integration_credentials"):
            connection.exec_driver_sql(f"CREATE TABLE {table} (id uuid PRIMARY KEY)")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert not inspect(connection).has_table("pdf_cache_entries")
            migration.upgrade()
            connection.exec_driver_sql("INSERT INTO users VALUES (gen_random_uuid())")
            connection.exec_driver_sql(
                "INSERT INTO webdav_monthly_usage SELECT id, CURRENT_DATE, 123 FROM users"
            )
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            assert (
                connection.scalar(text("SELECT downloaded_bytes FROM webdav_monthly_usage")) == 123
            )
            connection.exec_driver_sql("DELETE FROM webdav_monthly_usage")
            connection.exec_driver_sql("INSERT INTO resources VALUES (gen_random_uuid(), 1)")
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
