import importlib.util
from datetime import date
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine, utc_now
from sqlalchemy import Connection, MetaData, Table, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0055_weekly_reviews.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weekly_additive_roundtrip_owner_constraints_and_nonempty_refusal() -> None:
    spec = importlib.util.spec_from_file_location("weekly_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"weekly_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        for table in ("spaces", "ai_runs"):
            connection.exec_driver_sql(
                f"CREATE TABLE {table} (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
                "UNIQUE(id,workspace_id))"
            )
        connection.exec_driver_sql(
            "CREATE TABLE resources (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "space_id uuid NOT NULL, research_owner_id uuid NOT NULL, "
            "UNIQUE(id,workspace_id,space_id,research_owner_id))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE tasks (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, "
            "space_id uuid NOT NULL, created_by uuid NOT NULL, title text NOT NULL)"
        )
        user, peer, workspace, space, source, legacy = [uuid4() for _ in range(6)]
        params = dict(
            user=user, peer=peer, workspace=workspace, space=space, source=source, legacy=legacy
        )
        connection.execute(text("INSERT INTO users VALUES (:user),(:peer)"), params)
        connection.execute(text("INSERT INTO spaces VALUES (:space,:workspace)"), params)
        connection.execute(
            text("INSERT INTO resources VALUES (:source,:workspace,:space,:user)"), params
        )
        connection.execute(
            text("INSERT INTO tasks VALUES (:legacy,:workspace,:space,:user,'Legacy task')"), params
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.downgrade()
            migration.upgrade()
            assert (
                connection.scalar(text("SELECT title FROM tasks WHERE id=:legacy"), params)
                == "Legacy task"
            )
            for sql in (
                "UPDATE tasks SET resource_id=:source",
                "UPDATE tasks SET research_owner_id=:user",
                "UPDATE tasks SET research_owner_id=:user,reading_mode='invalid',"
                "scheduled_on='2026-09-28'",
                "UPDATE tasks SET research_owner_id=:peer,reading_mode='skim',"
                "scheduled_on='2026-09-28'",
                "UPDATE tasks SET research_owner_id=:peer,created_by=:peer,resource_id=:source,"
                "reading_mode='skim',"
                "scheduled_on='2026-09-28'",
            ):
                with connection.begin_nested() as nested:
                    with pytest.raises(IntegrityError):
                        connection.execute(text(sql), params)
                    nested.rollback()
            with connection.begin_nested() as nested:
                connection.execute(
                    text(
                        "UPDATE tasks SET research_owner_id=:user,resource_id=:source,"
                        "reading_mode='skim',scheduled_on='2026-09-28'"
                    ),
                    params,
                )
                with pytest.raises(RuntimeError, match="Preserve"):
                    migration.downgrade()
                nested.rollback()
            table = Table("weekly_reviews", MetaData(), autoload_with=connection)
            values = dict(
                id=uuid4(),
                workspace_id=workspace,
                space_id=space,
                user_id=user,
                week_start=date(2026, 9, 28),
                timezone="UTC",
                stats={},
                task_snapshot=[],
                triage=[],
                version=1,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
            connection.execute(table.insert().values(**values))
            for changes in (
                {"week_start": date(2026, 9, 29)},
                {"version": 0},
                {"stats": []},
                {"space_id": uuid4()},
            ):
                with connection.begin_nested() as nested:
                    with pytest.raises(IntegrityError):
                        connection.execute(
                            table.insert().values(**{**values, "id": uuid4(), **changes})
                        )
                    nested.rollback()
            with connection.begin_nested() as nested:
                with pytest.raises(IntegrityError):
                    connection.execute(table.insert().values(**{**values, "id": uuid4()}))
                nested.rollback()
            with pytest.raises(RuntimeError, match="Preserve"):
                migration.downgrade()

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
