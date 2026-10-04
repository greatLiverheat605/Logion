import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0058_form_drafts.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_draft_migration_preserves_parent_data_and_refuses_lossy_downgrade():
    spec = importlib.util.spec_from_file_location("form_drafts_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"draft_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE spaces (id uuid, workspace_id uuid, PRIMARY KEY (id, workspace_id))"
        )
        user, space, workspace = uuid4(), uuid4(), uuid4()
        connection.execute(text("INSERT INTO users VALUES (:id)"), {"id": user})
        connection.execute(
            text("INSERT INTO spaces VALUES (:space,:workspace)"),
            {"space": space, "workspace": workspace},
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            connection.execute(
                text(
                    "INSERT INTO form_drafts VALUES "
                    "(:id,:user,:workspace,:space,'idea_create',:target,"
                    "'{\"body\":\"synthetic\"}',1,now(),now()+interval '7 days')"
                ),
                {
                    "id": uuid4(),
                    "user": user,
                    "workspace": workspace,
                    "space": space,
                    "target": uuid4(),
                },
            )
            with pytest.raises(RuntimeError, match="Preserve server form drafts"):
                migration.downgrade()
            assert connection.scalar(text("SELECT fields->>'body' FROM form_drafts")) == "synthetic"
            connection.execute(text("DELETE FROM users WHERE id=:user"), {"user": user})
            assert connection.scalar(text("SELECT count(*) FROM form_drafts")) == 0
            migration.downgrade()
            assert "form_drafts" not in inspect(connection).get_table_names(schema=schema)
            assert connection.scalar(text("SELECT count(*) FROM spaces")) == 1

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
