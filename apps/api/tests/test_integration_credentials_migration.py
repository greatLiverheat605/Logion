import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations/versions/0046_integration_credentials.py"
)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_integration_credentials_migration_preserves_nonempty_data() -> None:
    spec = importlib.util.spec_from_file_location("integration_credentials_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"integration_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        owner = uuid4()
        connection.execute(text("INSERT INTO users VALUES (:owner)"), {"owner": owner})
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            assert not inspect(connection).has_table("integration_credentials")
            migration.upgrade()
            connection.execute(
                text("""
                INSERT INTO integration_credentials
                  (id,user_id,provider,ciphertext,nonce,wrapped_key,key_nonce,key_id,
                   connected,updated_at)
                VALUES (gen_random_uuid(),:owner,'zotero','synthetic',decode(repeat('00',12),'hex'),
                  'synthetic',decode(repeat('00',12),'hex'),'synthetic',false,now())
            """),
                {"owner": owner},
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql(
                    "UPDATE integration_credentials SET provider='untrusted'"
                )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.exec_driver_sql("UPDATE integration_credentials SET nonce='short'")
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM integration_credentials")) == 1

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
