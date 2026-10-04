import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0057_session_persistence.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_persistence_migration_preserves_legacy_sessions_and_blocks_unsafe_downgrade():
    spec = importlib.util.spec_from_file_location("session_persistence_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"persistence_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql(
            "CREATE TABLE auth_sessions (id int PRIMARY KEY, revoked_at timestamptz, "
            "refresh_expires_at timestamptz NOT NULL)"
        )
        connection.exec_driver_sql(
            "CREATE TABLE mfa_challenges (id int PRIMARY KEY, used_at timestamptz, "
            "expires_at timestamptz NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO auth_sessions VALUES (1,NULL,now()+interval '1 day')"
        )
        connection.exec_driver_sql(
            "INSERT INTO mfa_challenges VALUES (1,NULL,now()+interval '1 day')"
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.scalar(text("SELECT keep_signed_in FROM auth_sessions")) is True
            assert connection.scalar(text("SELECT keep_signed_in FROM mfa_challenges")) is True
            migration.downgrade()
            assert "keep_signed_in" not in {
                c["name"] for c in inspect(connection).get_columns("auth_sessions")
            }
            migration.upgrade()
            connection.exec_driver_sql("UPDATE auth_sessions SET keep_signed_in=false")
            with pytest.raises(RuntimeError, match="Revoke or expire"):
                migration.downgrade()
            connection.exec_driver_sql("UPDATE auth_sessions SET revoked_at=now()")
            connection.exec_driver_sql("UPDATE mfa_challenges SET keep_signed_in=false")
            with pytest.raises(RuntimeError, match="Revoke or expire"):
                migration.downgrade()
            connection.exec_driver_sql("UPDATE mfa_challenges SET used_at=now()")
            migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM auth_sessions")) == 1

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
