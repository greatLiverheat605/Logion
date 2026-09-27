import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from logion_api.db import engine
from sqlalchemy import Connection, inspect, text
from sqlalchemy.exc import IntegrityError

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "migrations/versions/0043_workspace_invitation_email.py"
)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_invitation_email_migration_preserves_legacy_rows_and_guards_downgrade() -> None:
    spec = importlib.util.spec_from_file_location("invitation_email_migration", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    def round_trip(connection: Connection) -> None:
        # A transaction-local schema keeps this proof independent of application test rows.
        schema = f"invitation_migration_{uuid4().hex}"
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
        connection.exec_driver_sql("CREATE TABLE workspace_invitations (id uuid PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE email_outbox (id uuid PRIMARY KEY, purpose varchar(40) NOT NULL, "
            "action_token_id uuid, CONSTRAINT ck_email_outbox_purpose CHECK "
            "(purpose IN ('email_verification', 'password_recovery', 'security_notification')))"
        )
        legacy_id, invitation_id, delivery_id = uuid4(), uuid4(), uuid4()
        connection.execute(
            text("INSERT INTO email_outbox (id, purpose) VALUES (:id, 'security_notification')"),
            {"id": legacy_id},
        )
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.scalar(text("SELECT count(*) FROM email_outbox")) == 1
            assert (
                connection.scalar(
                    text("SELECT workspace_invitation_id FROM email_outbox WHERE id = :id"),
                    {"id": legacy_id},
                )
                is None
            )
            connection.execute(
                text("INSERT INTO workspace_invitations VALUES (:id)"), {"id": invitation_id}
            )
            for purpose, linked_id, action_id in [
                ("workspace_invitation", None, None),
                ("workspace_invitation", invitation_id, uuid4()),
                ("security_notification", invitation_id, None),
                ("workspace_invitation", uuid4(), None),
            ]:
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        text(
                            "INSERT INTO email_outbox VALUES (:id, :purpose, :action, :invitation)"
                        ),
                        {
                            "id": uuid4(),
                            "purpose": purpose,
                            "action": action_id,
                            "invitation": linked_id,
                        },
                    )
            connection.execute(
                text(
                    "INSERT INTO email_outbox VALUES (:id, 'workspace_invitation', NULL, :invite)"
                ),
                {"id": delivery_id, "invite": invitation_id},
            )
            with pytest.raises(RuntimeError, match="delivery records still exist"):
                migration.downgrade()
            assert connection.scalar(text("SELECT count(*) FROM email_outbox")) == 2
            connection.execute(text("DELETE FROM email_outbox WHERE id = :id"), {"id": delivery_id})
            migration.downgrade()
            assert "workspace_invitation_id" not in {
                column["name"] for column in inspect(connection).get_columns("email_outbox")
            }
            assert connection.scalar(text("SELECT id FROM email_outbox")) == legacy_id
            migration.upgrade()
            assert "workspace_invitation_id" in {
                column["name"] for column in inspect(connection).get_columns("email_outbox")
            }

    async with engine.connect() as connection, connection.begin() as transaction:
        await connection.run_sync(round_trip)
        await transaction.rollback()
