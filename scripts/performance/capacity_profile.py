#!/usr/bin/env python3
# ruff: noqa: E501
"""Generate and measure the mandatory Logion release-capacity profile."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import os
import platform
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg  # type: ignore[import-untyped]

PROFILE_VERSION = "logion-capacity-v1"
USER_ID = "10000000-0000-7000-8000-000000000001"
WORKSPACE_ID = "10000000-0000-7000-8000-000000000002"
MEMBERSHIP_ID = "10000000-0000-7000-8000-000000000003"
SPACE_ID = "10000000-0000-7000-8000-000000000004"
GOAL_ID = "10000000-0000-7000-8000-000000000005"
PLAN_ID = "10000000-0000-7000-8000-000000000006"
PLAN_VERSION_ID = "10000000-0000-7000-8000-000000000007"
PHASE_ID = "10000000-0000-7000-8000-000000000008"
ROUTE_ID = "10000000-0000-7000-8000-000000000009"
ATTACHMENT_CONTENT = b"logion-capacity-verified-attachment-v1"
EXPECTED_COUNTS = {
    "tasks": 100_000,
    "events": 1_000_000,
    "notes": 25_000,
    "resources": 25_000,
    "attachments": 10_000,
    "papers": 5_000,
    "ai_runs": 100_000,
}


def percentile(values: list[float], percent: int) -> float:
    if not values:
        raise ValueError("percentile requires samples")
    ordered = sorted(values)
    index = max(0, math.ceil((percent / 100) * len(ordered)) - 1)
    return ordered[index]


def database_url(value: str) -> str:
    normalized = value.replace("postgresql+asyncpg://", "postgresql://", 1)
    parsed = urlsplit(normalized)
    if parsed.scheme != "postgresql" or not parsed.path.endswith("capacity"):
        raise ValueError("capacity profile requires a dedicated database ending in 'capacity'")
    return normalized


def hardware() -> dict[str, Any]:
    memory_kib = None
    meminfo = Path("/proc/meminfo")
    if meminfo.is_file():
        first = meminfo.read_text(encoding="utf-8").splitlines()[0].split()
        memory_kib = int(first[1])
    return {
        "runner": os.environ.get("LOGION_CAPACITY_PROFILE", "unapproved-local"),
        "system": platform.system(),
        "release": platform.release(),
        "machine": platform.machine(),
        "cpu_count": os.cpu_count(),
        "memory_kib": memory_kib,
        "python": platform.python_version(),
    }


def create_attachment_files(root: Path) -> dict[str, int]:
    verified = root.resolve() / "verified" / WORKSPACE_ID
    verified.mkdir(mode=0o700, parents=True, exist_ok=True)
    started = time.perf_counter()
    for index in range(1, EXPECTED_COUNTS["attachments"] + 1):
        identifier = UUID(
            hashlib.md5(f"attachment-{index}".encode(), usedforsecurity=False).hexdigest()
        )
        path = verified / str(identifier)
        path.write_bytes(ATTACHMENT_CONTENT)
        path.chmod(0o600)
    files = [path for path in verified.iterdir() if path.is_file()]
    return {
        "count": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "generation_ms": round((time.perf_counter() - started) * 1000),
    }


async def seed(connection: asyncpg.Connection[Any]) -> None:
    attachment_sha = hashlib.sha256(ATTACHMENT_CONTENT).hexdigest()
    attachment_size = len(ATTACHMENT_CONTENT)
    user_id = UUID(USER_ID)
    workspace_id = UUID(WORKSPACE_ID)
    space_id = UUID(SPACE_ID)
    goal_id = UUID(GOAL_ID)
    phase_id = UUID(PHASE_ID)
    await connection.execute(
        """INSERT INTO users (id,email,email_normalized,status,version,created_at,updated_at)
        VALUES ($1,'capacity@example.invalid','capacity@example.invalid','active',1,now(),now())""",
        user_id,
    )
    await connection.execute(
        """INSERT INTO workspaces (id,name,status,version,created_by,created_at,updated_at)
        VALUES ($1,'Capacity profile','active',1,$2,now(),now())""",
        workspace_id,
        user_id,
    )
    await connection.execute(
        """INSERT INTO workspace_memberships
        (id,workspace_id,user_id,role,status,version,joined_at,created_at,updated_at)
        VALUES ($1,$2,$3,'owner','active',1,now(),now(),now())""",
        UUID(MEMBERSHIP_ID),
        workspace_id,
        user_id,
    )
    await connection.execute(
        """INSERT INTO spaces
        (id,workspace_id,owner_user_id,name,visibility,status,version,created_by,updated_by,created_at,updated_at)
        VALUES ($1,$2,$3,'Capacity private','private','active',1,$3,$3,now(),now())""",
        space_id,
        workspace_id,
        user_id,
    )
    await connection.execute(
        """INSERT INTO learning_goals
        (id,workspace_id,space_id,title,description,desired_outcome,status,weekly_minutes,version,created_by,updated_by,created_at,updated_at)
        VALUES ($1,$2,$3,'Capacity goal','','Measure release profile','active',60,1,$4,$4,now(),now())""",
        goal_id,
        workspace_id,
        space_id,
        user_id,
    )
    await connection.execute(
        """INSERT INTO learning_plans
        (id,workspace_id,space_id,goal_id,title,status,version,created_by,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'Capacity plan','active',1,$5,now(),now())""",
        UUID(PLAN_ID),
        workspace_id,
        space_id,
        goal_id,
        user_id,
    )
    await connection.execute(
        """INSERT INTO plan_versions
        (id,workspace_id,plan_id,version_number,status,change_summary,created_by,created_at,published_at)
        VALUES ($1,$2,$3,1,'published','capacity',$4,now(),now())""",
        UUID(PLAN_VERSION_ID),
        workspace_id,
        UUID(PLAN_ID),
        user_id,
    )
    await connection.execute(
        """INSERT INTO plan_phases
        (id,workspace_id,plan_version_id,title,description,position,estimated_minutes,acceptance_criteria,created_at)
        VALUES ($1,$2,$3,'Capacity phase','',0,0,'[]'::jsonb,now())""",
        phase_id,
        workspace_id,
        UUID(PLAN_VERSION_ID),
    )
    await connection.execute(
        """INSERT INTO ai_task_routes
        (id,workspace_id,name,normalized_name,task_type,requires_json,requires_stream,max_input_tokens,max_output_tokens,enabled,version,created_by,updated_by,created_at,updated_at)
        VALUES ($1,$2,'Capacity route','capacity route','capacity',false,false,100,100,true,1,$3,$3,now(),now())""",
        UUID(ROUTE_ID),
        workspace_id,
        user_id,
    )
    await connection.execute(
        """
        INSERT INTO tasks
          (id,workspace_id,space_id,goal_id,phase_id,title,description,status,priority,estimated_minutes,due_at,version,created_by,updated_by,created_at,updated_at)
        SELECT md5('task-'||value)::uuid,$1,$2,$3,$4,
          'Task '||value,'','planned',2,30,now() + ((value % 365)||' days')::interval,1,
          $5,$5,now(),now()
        FROM generate_series(1,$6::integer) value
        """,
        workspace_id,
        space_id,
        goal_id,
        phase_id,
        user_id,
        EXPECTED_COUNTS["tasks"],
    )
    await connection.execute(
        """
        INSERT INTO audit_events
          (id,workspace_id,actor_id,request_id,event_type,target_type,target_id,result,metadata,occurred_at)
        SELECT md5('event-'||value)::uuid,$1,$2,'capacity-'||value,
          'capacity.event','task',md5('task-'||((value-1)%$3::integer+1))::uuid,
          'success','{}'::json,now() - (value||' milliseconds')::interval
        FROM generate_series(1,$4::integer) value
        """,
        workspace_id,
        user_id,
        EXPECTED_COUNTS["tasks"],
        EXPECTED_COUNTS["events"],
    )
    await connection.execute(
        """
        INSERT INTO notes
          (id,workspace_id,space_id,task_id,title,markdown_body,yjs_state,version,created_by,updated_by,created_at,updated_at)
        SELECT md5('note-'||value)::uuid,$1,$2,NULL,'Note '||value,'capacity',
          decode('AQGcrrftDQAEAQhtYXJrZG93bghjYXBhY2l0eQA=','base64'),1,$3,$3,now(),now()
        FROM generate_series(1,$4::integer) value
        """,
        workspace_id,
        space_id,
        user_id,
        EXPECTED_COUNTS["notes"],
    )
    await connection.execute(
        """
        INSERT INTO resources
          (id,workspace_id,space_id,task_id,resource_type,title,source_url,page_index,version,created_by,updated_by,created_at,updated_at)
        SELECT md5('resource-'||value)::uuid,$1,$2,NULL,'link','Resource '||value,
          'https://example.invalid/resource/'||value,'[]'::jsonb,1,$3,$3,now(),now()
        FROM generate_series(1,$4::integer) value
        """,
        workspace_id,
        space_id,
        user_id,
        EXPECTED_COUNTS["resources"],
    )
    await connection.execute(
        """
        INSERT INTO paper_records
          (id,workspace_id,space_id,user_id,version,created_by,updated_by,created_at,updated_at,title,citation_key,source_url)
        SELECT md5('paper-'||value)::uuid,$1,$2,$3,1,$3,$3,
          now(),now(),'Paper '||value,'capacity-'||value,'https://example.invalid/paper/'||value
        FROM generate_series(1,$4::integer) value
        """,
        workspace_id,
        space_id,
        user_id,
        EXPECTED_COUNTS["papers"],
    )
    await connection.execute(
        """
        INSERT INTO ai_runs
          (id,workspace_id,route_id,task_type,target_type,target_id,target_version,selected_fields,
           expected_output_fields,retain_input,prompt_version,prompt_hash,idempotency_key,request_hash,status,
           estimated_input_tokens,requested_output_tokens,reserved_tokens,reserved_cost_minor,actual_input_tokens,
           actual_output_tokens,actual_cost_minor,currency,attempt_count,requested_by,version,created_at,updated_at,completed_at)
        SELECT md5('ai-run-'||value)::uuid,$1,$2,'capacity','task',
          md5('task-'||((value-1)%$3::integer+1))::uuid,1,'[]'::jsonb,'[]'::jsonb,false,'v1',repeat('a',64),
          md5('ai-key-'||value)::uuid,repeat('b',64),'succeeded',1,1,2,0,1,1,0,'USD',1,$4,1,
          now() - (value||' milliseconds')::interval,now(),now()
        FROM generate_series(1,$5::integer) value
        """,
        workspace_id,
        UUID(ROUTE_ID),
        EXPECTED_COUNTS["tasks"],
        user_id,
        EXPECTED_COUNTS["ai_runs"],
    )
    await connection.execute(
        """
        INSERT INTO attachments
          (id,workspace_id,space_id,target_type,target_id,filename,declared_mime,detected_mime,size_bytes,
           expected_sha256,verified_sha256,status,staging_key,storage_key,version,created_by,created_at,updated_at,verified_at)
        SELECT md5('attachment-'||value)::uuid,$1,$2,'note',
          md5('note-'||((value-1)%$3::integer+1))::uuid,'capacity.txt','text/plain','text/plain',
          $4,$5,$5,'verified',md5('staging-'||value),
          $6||'/'||md5('attachment-'||value)::uuid,2,$7,now(),now(),now()
        FROM generate_series(1,$8::integer) value
        """,
        workspace_id,
        space_id,
        EXPECTED_COUNTS["notes"],
        attachment_size,
        attachment_sha,
        WORKSPACE_ID,
        user_id,
        EXPECTED_COUNTS["attachments"],
    )
    await connection.execute("ANALYZE")


QUERIES = {
    "tasks_due": (
        "SELECT id,title,due_at FROM tasks WHERE workspace_id=$1 AND status='planned' "
        "ORDER BY due_at,id LIMIT 100",
        WORKSPACE_ID,
    ),
    "audit_timeline": (
        "SELECT id,event_type,occurred_at FROM audit_events WHERE workspace_id=$1 "
        "ORDER BY occurred_at DESC,id DESC LIMIT 100",
        WORKSPACE_ID,
    ),
    "notes_recent": (
        "SELECT id,title,updated_at FROM notes WHERE workspace_id=$1 AND space_id=$2 "
        "ORDER BY updated_at DESC,id DESC LIMIT 100",
        WORKSPACE_ID,
        SPACE_ID,
    ),
    "attachment_lookup": (
        "SELECT id,status,storage_key FROM attachments WHERE workspace_id=$1 AND id=$2",
        WORKSPACE_ID,
        str(UUID(hashlib.md5(b"attachment-5000", usedforsecurity=False).hexdigest())),
    ),
    "papers_recent": (
        "SELECT id,title FROM paper_records WHERE workspace_id=$1 AND user_id=$2 "
        "ORDER BY updated_at DESC,id DESC LIMIT 100",
        WORKSPACE_ID,
        USER_ID,
    ),
    "ai_runs_recent": (
        "SELECT id,status FROM ai_runs WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
        WORKSPACE_ID,
    ),
}


async def measure(connection: asyncpg.Connection[Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    measurements: dict[str, Any] = {}
    plans: dict[str, Any] = {}
    for name, query in QUERIES.items():
        sql, *parameters = query
        for _ in range(5):
            await connection.fetch(sql, *parameters)
        samples: list[float] = []
        for _ in range(30):
            started = time.perf_counter()
            await connection.fetch(sql, *parameters)
            samples.append((time.perf_counter() - started) * 1000)
        measurements[name] = {
            "samples": len(samples),
            "p50_ms": round(percentile(samples, 50), 3),
            "p95_ms": round(percentile(samples, 95), 3),
            "p99_ms": round(percentile(samples, 99), 3),
            "max_ms": round(max(samples), 3),
            "threshold_ms": 500,
            "passed": percentile(samples, 95) < 500,
        }
        plan = await connection.fetchval(
            "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, *parameters
        )
        plans[name] = json.loads(plan) if isinstance(plan, str) else plan
    return measurements, plans


async def actual_counts(connection: asyncpg.Connection[Any]) -> dict[str, int]:
    queries = {
        "tasks": "SELECT count(*) FROM tasks",
        "events": "SELECT count(*) FROM audit_events",
        "notes": "SELECT count(*) FROM notes",
        "resources": "SELECT count(*) FROM resources",
        "attachments": "SELECT count(*) FROM attachments",
        "papers": "SELECT count(*) FROM paper_records",
        "ai_runs": "SELECT count(*) FROM ai_runs",
    }
    return {name: int(await connection.fetchval(query)) for name, query in queries.items()}


async def run(args: argparse.Namespace) -> dict[str, Any]:
    connection = await asyncpg.connect(database_url(args.database_url))
    started = time.perf_counter()
    try:
        await seed(connection)
        seed_seconds = time.perf_counter() - started
        counts = await actual_counts(connection)
        measurements, plans = await measure(connection)
        database_bytes = int(
            await connection.fetchval("SELECT pg_database_size(current_database())")
        )
        connections = int(
            await connection.fetchval(
                "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
            )
        )
    finally:
        await connection.close()
    files = create_attachment_files(Path(args.attachment_root))
    passed = (
        counts == EXPECTED_COUNTS
        and files["count"] == EXPECTED_COUNTS["attachments"]
        and files["bytes"] == EXPECTED_COUNTS["attachments"] * len(ATTACHMENT_CONTENT)
        and all(item["passed"] for item in measurements.values())
    )
    return {
        "schema_version": PROFILE_VERSION,
        "source_sha": args.source_sha,
        "profile_mode": "reference"
        if args.profile_label == "github-hosted-reference"
        else "operator",
        "production_equivalent_approved": False,
        "profile_label": args.profile_label,
        "hardware": hardware(),
        "generator": {"version": PROFILE_VERSION, "seed_seconds": round(seed_seconds, 3)},
        "expected_counts": EXPECTED_COUNTS,
        "actual_counts": counts,
        "attachment_files": files,
        "queries": measurements,
        "query_plans": plans,
        "saturation": {
            "database_bytes": database_bytes,
            "database_connections_observed": connections,
        },
        "errors": [],
        "passed": passed,
        "manual_signoff_required": [
            "approved production-like hardware profile",
            "production traffic and saturation validation",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--attachment-root", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--profile-label", default="github-hosted-reference")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if len(args.source_sha) != 40 or any(
        value not in "0123456789abcdef" for value in args.source_sha
    ):
        raise SystemExit("source-sha must be a full lowercase Git commit")
    report = asyncio.run(run(args))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    if not report["passed"]:
        raise SystemExit("capacity profile failed")


if __name__ == "__main__":
    main()
