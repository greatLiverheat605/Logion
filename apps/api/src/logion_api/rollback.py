"""Schema preflight and private-draft retention for the compatible old binary."""

import argparse
import asyncio
import json
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from logion_api.config import get_settings
from logion_api.db import session_factory

REQUIRED_COLUMNS = {
    "auth_sessions": {"keep_signed_in"},
    "mfa_challenges": {"keep_signed_in"},
    "form_drafts": {"id", "user_id", "space_id", "fields", "version", "expires_at"},
    "resources": {"research_owner_id", "legacy_paper_id", "citation_key"},
    "notes": {"research_owner_id", "note_kind", "resource_id", "agent_inbox_item_id"},
    "agent_tokens": {"user_id", "space_id", "token_digest", "revoked_at"},
    "agent_inbox_items": {"user_id", "token_id", "status", "accepted_payload", "receipt"},
    "topics": {"research_owner_id"},
    "quiz_items": {"research_owner_id", "resource_id", "origin"},
    "tasks": {"research_owner_id", "resource_id", "reading_mode", "scheduled_on"},
    "research_claims": {"resource_id"},
    "ai_runs": {"context_entity_types"},
}


async def cleanup_expired_drafts() -> bool:
    async with session_factory() as db:
        removed = list(
            await db.scalars(
                text(
                    "DELETE FROM form_drafts WHERE id IN "
                    "(SELECT id FROM form_drafts WHERE expires_at <= now() "
                    "ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id"
                )
            )
        )
        await db.commit()
        return bool(removed)


async def verify_schema(connection: AsyncConnection, expected_head: str) -> dict[str, object]:
    await connection.execute(text("SET TRANSACTION READ ONLY"))
    heads = list(await connection.scalars(text("SELECT version_num FROM alembic_version")))
    if heads != [expected_head]:
        raise ValueError("Rollback requires the exact schema head from its compatibility evidence")
    columns = await connection.execute(
        text(
            "SELECT table_name, column_name FROM information_schema.columns "
            "WHERE table_schema = current_schema()"
        )
    )
    observed: dict[str, set[str]] = {}
    for table, column in columns:
        observed.setdefault(table, set()).add(column)
    if any(
        not required <= observed.get(table, set()) for table, required in REQUIRED_COLUMNS.items()
    ):
        raise ValueError("Rollback privacy columns are missing; do not run the old migrations")
    validated = await connection.scalar(
        text(
            "SELECT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid "
            "JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=current_schema() "
            "AND t.relname='resources' AND c.conname='ck_resources_research_owner' "
            "AND c.convalidated)"
        )
    )
    if not validated:
        raise ValueError("Rollback requires the validated private resource type constraint")
    return {
        "schema_head": expected_head,
        "status": "passed",
        "read_only": True,
        "checked_columns": sum(map(len, REQUIRED_COLUMNS.values())),
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    engine = create_async_engine(get_settings().database_url)
    try:
        async with engine.connect() as connection:
            result = await verify_schema(connection, args.expected_head)
    finally:
        await engine.dispose()
    value = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(value, encoding="utf-8")
    print(value, end="")


if __name__ == "__main__":
    asyncio.run(main())
