"""Rehearse additive v0.3 migrations on synthetic data or an approved isolated copy.

Never restores, drops, downgrades, starts a worker, or connects to a remote database.
The restored-copy mode performs only schema migration and aggregate verification.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import importlib.util
import ipaddress
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

import asyncpg
from alembic.config import Config
from alembic.script import ScriptDirectory

ROOT = Path(__file__).resolve().parents[2]
OLD_HEAD = "0042_knowledge_source_links"


def local_database(value: str) -> str:
    value = value.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlsplit(value)
    hostname = parsed.hostname or ""
    local = hostname == "localhost"
    if not local:
        with suppress(ValueError):
            local = ipaddress.ip_address(hostname).is_loopback
    name = unquote(parsed.path).removeprefix("/")
    if (
        parsed.scheme != "postgresql"
        or not local
        or not re.fullmatch(r"[a-z][a-z0-9_]*_(rehearsal|capacity)", name)
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Use a loopback database ending in _rehearsal or _capacity")
    return value


def identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def command(args: list[str], env: dict[str, str], output: Path, cwd: Path = ROOT) -> None:
    with output.open("w", encoding="utf-8") as log:
        # Fixed argv below; never interpreted by a shell.
        subprocess.run(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)  # noqa: S603


async def digest_table(
    connection: Any, table: str, columns: list[str], keys: list[str], *, retained: bool
) -> dict[str, Any]:
    fields = ",".join(identifier(column) for column in columns)
    order = ",".join(identifier(column) for column in keys)
    # Catalog identifiers are double-quoted, including embedded quote characters.
    query = f"SELECT jsonb_build_array({fields})::text FROM {identifier(table)}"  # noqa: S608
    if table == "resources" and retained:
        query += " WHERE id IN (SELECT id FROM logion_rehearsal_resource_ids)"
    query += f" ORDER BY {order}"
    digest = hashlib.sha256()
    count = 0
    async with connection.transaction(readonly=True):
        async for record in connection.cursor(query, prefetch=1000):
            value = record[0].encode("utf-8")
            digest.update(len(value).to_bytes(8, "big"))
            digest.update(value)
            count += 1
    return {"rows": count, "sha256": digest.hexdigest()}


async def old_tables(connection: Any) -> dict[str, dict[str, list[str]]]:
    result = {}
    tables = await connection.fetch(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' "
        "AND tablename <> 'alembic_version' ORDER BY tablename"
    )
    for row in tables:
        table = row["tablename"]
        columns = [
            r["column_name"]
            for r in await connection.fetch(
                "SELECT column_name FROM information_schema.columns WHERE table_schema='public' "
                "AND table_name=$1 ORDER BY ordinal_position",
                table,
            )
        ]
        keys = [
            r["attname"]
            for r in await connection.fetch(
                "SELECT a.attname FROM pg_index i CROSS JOIN LATERAL "
                "unnest(i.indkey) WITH ORDINALITY k(attnum, pos) "
                "JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum "
                "WHERE i.indrelid=to_regclass($1) AND i.indisprimary ORDER BY k.pos",
                "public." + identifier(table),
            )
        ]
        if not keys:
            raise ValueError("Every pre-migration table must have a stable primary key")
        result[table] = {"columns": columns, "keys": keys}
    return result


def synthetic_environment(database: str) -> dict[str, str]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("LOGION_")}
    env.update(
        PYTHONPATH=str(ROOT / "apps/api/src") + os.pathsep + str(ROOT / "apps/worker/src"),
        LOGION_ENV="test",
        LOGION_DATABASE_URL=database.replace("postgresql://", "postgresql+asyncpg://", 1),
        LOGION_SECRET_KEY=secrets.token_hex(32),
        LOGION_ALLOWED_ORIGINS='["http://test","http://localhost:3000"]',
        LOGION_WEBAUTHN_RP_ID="test",
        LOGION_WEBAUTHN_ORIGINS='["http://test"]',
    )
    for prefix in ("TOTP", "EMAIL_DELIVERY", "AI_CREDENTIAL", "DATA_EXPORT"):
        env[f"LOGION_{prefix}_ACTIVE_ENCRYPTION_KEY_ID"] = "rehearsal"
        env[f"LOGION_{prefix}_ENCRYPTION_KEYS"] = json.dumps(
            {"rehearsal": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")}
        )
    return env


def verified_source(expected: str, root: Path = ROOT) -> str:
    git = shutil.which("git")
    if git is None:
        raise ValueError("Git is required to verify the migration source")
    source = subprocess.check_output([git, "rev-parse", "HEAD"], cwd=root, text=True).strip()  # noqa: S603
    if source != expected:
        raise ValueError("Migration source does not match the approved full SHA")
    subprocess.run(  # noqa: S603
        [git, "diff", "--exit-code", "HEAD", "--", "apps/api/migrations"],
        cwd=root,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    untracked = subprocess.check_output(  # noqa: S603
        [git, "ls-files", "--others", "--exclude-standard", "--", "apps/api/migrations"],
        cwd=root,
        text=True,
    )
    if untracked:
        raise ValueError("Untracked migrations cannot be bound to a source SHA")
    return source


def local_redis(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        or parsed.scheme != "redis"
        or not re.fullmatch(r"/[1-9][0-9]*", parsed.path)
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Use a dedicated nonzero loopback Redis database")
    return value


async def run(args: argparse.Namespace) -> dict[str, Any]:
    database = local_database(os.environ["LOGION_REHEARSAL_DATABASE_URL"])
    source = await asyncio.to_thread(verified_source, args.expected_source)
    head = ScriptDirectory.from_config(
        Config(str(ROOT / "apps/api/alembic.ini"))
    ).get_current_head()
    if not head or head == OLD_HEAD:
        raise ValueError("A single forward migration head is required")
    rollback_source = None
    rollback = None
    redis = None
    if args.mode == "synthetic":
        if args.rollback_root is None or args.expected_rollback_source is None:
            raise ValueError("Synthetic acceptance requires a pinned rollback source and root")
        rollback = args.rollback_root.resolve()
        rollback_source = await asyncio.to_thread(
            verified_source, args.expected_rollback_source, rollback
        )
        legacy_head = ScriptDirectory.from_config(
            Config(str(rollback / "apps/api/alembic.ini"))
        ).get_current_head()
        if legacy_head != OLD_HEAD:
            raise ValueError("Rollback migration head does not match the rehearsal starting schema")
        redis = local_redis(os.environ["LOGION_REHEARSAL_REDIS_URL"])
    elif not args.ack_isolated_copy:
        raise ValueError("Restored-copy mode requires the owner's approval and --ack-isolated-copy")
    args.output.mkdir(parents=True, exist_ok=False)
    env = synthetic_environment(database)
    migration = [
        sys.executable,
        "-m",
        "alembic",
        "-c",
        str(ROOT / "apps/api/alembic.ini"),
        "upgrade",
    ]
    connection = await asyncpg.connect(database)
    started = time.monotonic()
    try:
        if args.mode == "synthetic":
            if await connection.fetchval(
                "SELECT count(*) FROM pg_tables WHERE schemaname='public'"
            ):
                raise ValueError("Synthetic rehearsal requires a new empty database")
            await asyncio.to_thread(
                command, [*migration, OLD_HEAD], env, args.output / "old-schema.log"
            )
            spec = importlib.util.spec_from_file_location(
                "capacity_profile", ROOT / "scripts/performance/capacity_profile.py"
            )
            assert spec is not None and spec.loader is not None
            profile = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(profile)
            async with connection.transaction():
                await profile.seed(connection)
        revision = await connection.fetch("SELECT version_num FROM alembic_version")
        if [row[0] for row in revision] != [OLD_HEAD]:
            raise ValueError(
                "Expected the preserved 0.2.4 schema; no automatic downgrade is allowed"
            )
        tables = await old_tables(connection)
        await connection.execute(
            "CREATE TEMP TABLE logion_rehearsal_resource_ids AS SELECT id FROM resources"
        )
        before = {
            table: await digest_table(connection, table, **shape, retained=False)
            for table, shape in tables.items()
        }
        await asyncio.to_thread(
            command, [*migration, "head"], env, args.output / "forward-migration.log"
        )
        revision = await connection.fetch("SELECT version_num FROM alembic_version")
        if [row[0] for row in revision] != [head]:
            raise ValueError("The migrated database must have exactly the expected head")
        after = {
            table: await digest_table(connection, table, **shape, retained=True)
            for table, shape in tables.items()
        }
        if before != after:
            raise ValueError("Pre-existing row counts or old-column hashes changed")
        total = await connection.fetchval("SELECT count(*) FROM resources")
        mapped = await connection.fetchval(
            "SELECT count(*) FROM resources WHERE legacy_paper_id IS NOT NULL"
        )
        papers = before["paper_records"]["rows"]
        if total != before["resources"]["rows"] + papers or mapped != papers:
            raise ValueError("Legacy paper resource mapping count differs")
        invalid = await connection.fetchval(
            "SELECT count(*) FROM paper_records p LEFT JOIN resources r ON r.legacy_paper_id=p.id "
            "WHERE r.id IS NULL OR r.resource_type <> 'paper' OR "
            "ROW(r.research_owner_id,r.title,r.citation_key,r.source_url,r.version,r.workspace_id,"
            "r.space_id,r.created_by,r.updated_by,r.created_at,r.updated_at,r.deleted_at) "
            "IS DISTINCT FROM ROW(p.user_id,p.title,p.citation_key,p.source_url,p.version,"
            "p.workspace_id,p.space_id,p.created_by,p.updated_by,p.created_at,p.updated_at,p.deleted_at)"
        )
        invalid_claims = await connection.fetchval(
            "SELECT count(*) FROM research_claims c LEFT JOIN resources r "
            "ON r.legacy_paper_id=c.paper_id "
            "WHERE c.resource_id IS DISTINCT FROM r.id"
        )
        if invalid or invalid_claims:
            raise ValueError("Legacy paper or claim resource mapping differs")
        result = {
            "status": "passed",
            "mode": args.mode,
            "source_commit": source,
            "rollback_commit": rollback_source,
            "script_sha256": hashlib.sha256(
                await asyncio.to_thread(Path(__file__).read_bytes)
            ).hexdigest(),
            "old_head": OLD_HEAD,
            "new_head": head,
            "tables": before,
            "old_columns_unchanged": True,
            "derived_resources": mapped,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "production_accessed": False,
            "api_smoke": "not_run",
        }
    finally:
        await connection.close()
    (args.output / "migration-verification.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    if args.mode == "synthetic":
        assert rollback is not None and redis is not None
        env["LOGION_REDIS_URL"] = redis
        for root, test_file, label in (
            (ROOT, "apps/api/tests/test_library.py", "forward"),
            (rollback, "apps/api/tests/test_rollback_compatibility.py", "rollback"),
        ):
            current_env = {
                **env,
                "PYTHONPATH": str(root / "apps/api/src")
                + os.pathsep
                + str(root / "apps/worker/src"),
            }
            await asyncio.to_thread(
                command,
                [sys.executable, "-m", "pytest", "-q", "-m", "integration", test_file],
                current_env,
                args.output / f"{label}-api-smoke.log",
                root,
            )
        result["api_smoke"] = "forward_and_rollback_passed"
    (args.output / "rehearsal.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("synthetic", "restored-copy"), required=True)
    parser.add_argument("--expected-source", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rollback-root", type=Path)
    parser.add_argument("--expected-rollback-source")
    parser.add_argument("--ack-isolated-copy", action="store_true")
    args = parser.parse_args()
    result = asyncio.run(run(args))
    print(json.dumps({key: result[key] for key in ("status", "mode", "new_head", "api_smoke")}))


if __name__ == "__main__":
    main()
