import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/versions/0044_research_resources.py"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_paper_mapping_round_trip_constraints_and_lossless_downgrade() -> None:
    spec = importlib.util.spec_from_file_location("research_resources_migration", MIGRATION)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def verify(connection: Connection) -> None:
        schema = f"research_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE users (id uuid PRIMARY KEY)")
        connection.exec_driver_sql("""
            CREATE TABLE paper_records (
                id uuid PRIMARY KEY, workspace_id uuid NOT NULL, space_id uuid NOT NULL,
                user_id uuid NOT NULL, title varchar(300) NOT NULL, citation_key varchar(160),
                source_url text, version bigint NOT NULL, created_by uuid NOT NULL,
                updated_by uuid NOT NULL, created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL, deleted_at timestamptz
            )
        """)
        connection.exec_driver_sql("""
            CREATE TABLE resources (
                id uuid PRIMARY KEY, workspace_id uuid NOT NULL, space_id uuid NOT NULL,
                task_id uuid, resource_type varchar(16) NOT NULL, title varchar(300) NOT NULL,
                source_url text, page_index jsonb NOT NULL, version bigint NOT NULL,
                created_by uuid NOT NULL, updated_by uuid NOT NULL, created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL, deleted_at timestamptz,
                CONSTRAINT ck_resources_type CHECK (resource_type IN ('link','pdf_index'))
            )
        """)
        connection.exec_driver_sql("""
            CREATE TABLE research_claims (
                id uuid PRIMARY KEY, workspace_id uuid NOT NULL, space_id uuid NOT NULL,
                user_id uuid NOT NULL, paper_id uuid NOT NULL
            )
        """)
        owner, other, workspace, space, paper, deleted, claim = [uuid4() for _ in range(7)]
        values = {
            "owner": owner,
            "other": other,
            "workspace": workspace,
            "space": space,
            "paper": paper,
            "deleted": deleted,
            "claim": claim,
        }
        connection.execute(text("INSERT INTO users VALUES (:owner), (:other)"), values)
        connection.execute(
            text("""
            INSERT INTO paper_records VALUES
            (:paper, :workspace, :space, :owner, 'Synthetic paper', 'sample',
             'https://example.com/paper', 3, :owner, :owner, now(), now(), NULL),
            (:deleted, :workspace, :space, :other, 'Deleted paper', 'deleted',
             NULL, 1, :other, :other, now(), now(), now())
        """),
            values,
        )
        # A resource deliberately has the same UUID as a paper: migration must keep both.
        connection.execute(
            text("""
            INSERT INTO resources VALUES
            (:paper, :workspace, :space, NULL, 'link', 'Existing link',
             NULL, '[]'::jsonb, 1, :owner, :owner, now(), now(), NULL)
        """),
            values,
        )
        connection.execute(
            text("""
            INSERT INTO research_claims VALUES (:claim, :workspace, :space, :owner, :paper)
        """),
            values,
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.scalar(text("SELECT count(*) FROM resources")) == 3
            mapped = connection.execute(
                text("""
                SELECT id, research_owner_id, version, title, citation_key, reading_status
                FROM resources WHERE legacy_paper_id = :paper
            """),
                values,
            ).one()
            assert mapped.id != paper
            assert tuple(mapped)[1:] == (owner, 3, "Synthetic paper", "sample", "unread")
            assert connection.scalar(text("SELECT resource_id FROM research_claims")) == mapped.id
            assert connection.scalar(
                text("""
                SELECT deleted_at IS NOT NULL FROM resources WHERE legacy_paper_id = :deleted
            """),
                values,
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(text("UPDATE research_claims SET user_id = :other"), values)
            migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM paper_records")) == 2
            assert connection.scalar(text("SELECT count(*) FROM resources")) == 1
            assert connection.scalar(text("SELECT title FROM resources")) == "Existing link"
            assert "resource_id" not in {
                c["name"] for c in inspect(connection).get_columns("research_claims")
            }
            migration.upgrade()
            connection.execute(
                text("""
                UPDATE resources SET doi = '10.1234/synthetic'
                WHERE legacy_paper_id IS NOT NULL
            """)
            )
            # Same DOI, same Space, different owners is valid.
            assert (
                connection.scalar(text("SELECT count(*) FROM resources WHERE doi IS NOT NULL")) == 2
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text("""
                    UPDATE resources SET research_owner_id = :owner, deleted_at = NULL
                    WHERE legacy_paper_id = :deleted
                """),
                    values,
                )
            with pytest.raises(RuntimeError, match="must be preserved"):
                migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM resources")) == 3

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(verify)
        await transaction.rollback()
