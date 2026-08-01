import argparse
import asyncio
import json
import os
from collections.abc import Awaitable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal, cast

from logion_api.config import Settings, get_settings
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from logion_worker import __version__


def utc_now() -> datetime:
    return datetime.now(UTC)


def health_payload() -> dict[str, str]:
    """Stable, non-sensitive metadata for structured worker log events."""

    return {"status": "ok", "service": "worker", "version": __version__}


@dataclass
class WorkerRuntimeState:
    pid: int
    started_at: str
    heartbeat_at: str
    last_successful_poll_at: str | None = None
    consecutive_failures: int = 0
    last_error_type: str | None = None
    last_error_code: str | None = None
    last_queue: str | None = None
    queue_failures: dict[str, int] | None = None
    running: bool = True

    @classmethod
    def started(cls, now: datetime | None = None) -> "WorkerRuntimeState":
        timestamp = (now or utc_now()).isoformat()
        return cls(
            pid=os.getpid(),
            started_at=timestamp,
            heartbeat_at=timestamp,
            queue_failures={},
        )


class WorkerHealthTracker:
    def __init__(self, path: str | Path, now: datetime | None = None) -> None:
        self.path = Path(path)
        self.state = WorkerRuntimeState.started(now)
        self._persist()

    def heartbeat(self, now: datetime | None = None) -> None:
        self.state.heartbeat_at = (now or utc_now()).isoformat()
        self._persist()

    def record_success(
        self,
        queue: str | None,
        successful_queues: tuple[str, ...],
        now: datetime | None = None,
    ) -> None:
        timestamp = (now or utc_now()).isoformat()
        self.state.heartbeat_at = timestamp
        self.state.last_successful_poll_at = timestamp
        failures = self.state.queue_failures or {}
        for name in successful_queues:
            failures[name] = 0
        self.state.queue_failures = failures
        self.state.consecutive_failures = max(failures.values(), default=0)
        if self.state.consecutive_failures == 0:
            self.state.last_error_type = None
            self.state.last_error_code = None
        self.state.last_queue = queue
        self._persist()

    def record_failure(
        self,
        queue: str | None,
        error: Exception,
        *,
        successful_queues: tuple[str, ...] = (),
        error_code: str = "WORKER_JOB_EXCEPTION",
        now: datetime | None = None,
    ) -> None:
        self.state.heartbeat_at = (now or utc_now()).isoformat()
        failures = self.state.queue_failures or {}
        for name in successful_queues:
            failures[name] = 0
        if queue is not None:
            failures[queue] = failures.get(queue, 0) + 1
        self.state.queue_failures = failures
        self.state.consecutive_failures = max(failures.values(), default=1)
        self.state.last_error_type = type(error).__name__
        self.state.last_error_code = error_code
        self.state.last_queue = queue
        self._persist()

    def record_stopped(self, now: datetime | None = None) -> None:
        self.state.heartbeat_at = (now or utc_now()).isoformat()
        self.state.running = False
        self._persist()

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{self.state.pid}.tmp")
        temporary.write_text(
            json.dumps(asdict(self.state), separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(temporary, self.path)


def load_runtime_state(path: str | Path) -> WorkerRuntimeState | None:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            return None
        return WorkerRuntimeState(
            pid=int(value["pid"]),
            started_at=str(value["started_at"]),
            heartbeat_at=str(value["heartbeat_at"]),
            last_successful_poll_at=_optional_string(value.get("last_successful_poll_at")),
            consecutive_failures=int(value.get("consecutive_failures", 0)),
            last_error_type=_optional_string(value.get("last_error_type")),
            last_error_code=_optional_string(value.get("last_error_code")),
            last_queue=_optional_string(value.get("last_queue")),
            queue_failures=_queue_failures(value.get("queue_failures")),
            running=value.get("running") is True,
        )
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _queue_failures(value: object) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        str(name): int(count)
        for name, count in value.items()
        if isinstance(name, str) and isinstance(count, int) and count >= 0
    }


def _parse_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def build_health_report(
    mode: Literal["live", "ready"],
    state: WorkerRuntimeState | None,
    *,
    now: datetime,
    stale_after_seconds: int,
    failure_threshold: int,
    process_running: bool,
    dependencies: dict[str, str] | None = None,
    queues: dict[str, dict[str, int | None]] | None = None,
) -> dict[str, Any]:
    heartbeat = _parse_timestamp(state.heartbeat_at) if state is not None else None
    heartbeat_age = (
        max(0, int((now - heartbeat).total_seconds())) if heartbeat is not None else None
    )
    live = bool(
        state is not None
        and state.running
        and process_running
        and heartbeat_age is not None
        and heartbeat_age <= stale_after_seconds
    )
    checks: dict[str, str] = {
        "process": "ok" if live else "error",
        "heartbeat": "ok" if live else "error",
    }
    ready = live
    if mode == "ready":
        successful_poll = _parse_timestamp(
            state.last_successful_poll_at if state is not None else None
        )
        failures = state.consecutive_failures if state is not None else failure_threshold
        poll_ok = successful_poll is not None
        failures_ok = failures < failure_threshold
        checks.update(
            {
                "polling": "ok" if poll_ok else "error",
                "consecutive_failures": "ok" if failures_ok else "error",
            }
        )
        for name, status in (dependencies or {}).items():
            checks[name] = status
        ready = (
            ready
            and poll_ok
            and failures_ok
            and all(status == "ok" for status in (dependencies or {}).values())
        )

    report: dict[str, Any] = {
        "status": ("ok" if live else "error")
        if mode == "live"
        else ("ready" if ready else "not_ready"),
        "service": "worker",
        "version": __version__,
        "checks": checks,
        "heartbeat_age_seconds": heartbeat_age,
        "consecutive_failures": state.consecutive_failures if state is not None else None,
        "queue_failures": state.queue_failures if state is not None else None,
        "last_successful_poll_at": state.last_successful_poll_at if state is not None else None,
        "last_error_type": state.last_error_type if state is not None else None,
        "last_error_code": state.last_error_code if state is not None else None,
        "last_queue": state.last_queue if state is not None else None,
    }
    if queues is not None:
        report["queues"] = queues
    return report


async def dependency_snapshot(
    settings: Settings,
) -> tuple[dict[str, str], dict[str, dict[str, int | None]]]:
    checks: dict[str, str] = {}
    queues: dict[str, dict[str, int | None]] = {}
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with asyncio.timeout(settings.worker_health_dependency_timeout_seconds):
            async with engine.connect() as connection:
                rows = (
                    await connection.execute(
                        text(
                            """
                            SELECT
                                'email' AS queue,
                                count(*) FILTER (
                                    WHERE (status = 'pending' AND available_at <= now())
                                       OR (status = 'leased' AND lease_expires_at <= now())
                                ) AS queued,
                                count(*) FILTER (
                                    WHERE status = 'pending' AND available_at > now()
                                ) AS scheduled,
                                count(*) FILTER (
                                    WHERE status = 'leased' AND lease_expires_at > now()
                                ) AS running,
                                count(*) FILTER (WHERE status IN ('failed', 'dead')) AS failed,
                                min(created_at) FILTER (
                                    WHERE (status = 'pending' AND available_at <= now())
                                       OR (status = 'leased' AND lease_expires_at <= now())
                                ) AS oldest_at,
                                count(*) FILTER (
                                    WHERE status = 'leased' AND lease_expires_at <= now()
                                ) AS lease_overdue,
                                coalesce(sum(attempts) FILTER (
                                    WHERE status IN ('pending', 'leased')
                                ), 0) AS retry_attempts
                            FROM email_outbox
                            UNION ALL
                            SELECT
                                'export',
                                count(*) FILTER (WHERE status = 'queued'),
                                0,
                                count(*) FILTER (WHERE status = 'running'),
                                count(*) FILTER (WHERE status = 'failed'),
                                min(created_at) FILTER (WHERE status = 'queued'),
                                0,
                                0
                            FROM data_export_jobs
                            UNION ALL
                            SELECT
                                'ai',
                                count(*) FILTER (WHERE status = 'queued'),
                                0,
                                count(*) FILTER (WHERE status = 'running'),
                                count(*) FILTER (WHERE status = 'failed'),
                                min(created_at) FILTER (WHERE status = 'queued'),
                                0,
                                coalesce(sum(attempt_count) FILTER (
                                    WHERE status IN ('queued', 'running')
                                ), 0)
                            FROM ai_runs
                            UNION ALL
                            SELECT
                                'deletion',
                                count(*) FILTER (WHERE delete_after <= now()),
                                count(*) FILTER (WHERE delete_after > now()),
                                0,
                                0,
                                min(delete_after) FILTER (WHERE delete_after <= now()),
                                0,
                                0
                            FROM account_deletion_requests
                            WHERE status = 'pending'
                            """
                        )
                    )
                ).mappings()
                current = utc_now()
                for row in rows:
                    oldest = cast(datetime | None, row["oldest_at"])
                    queues[str(row["queue"])] = {
                        "queued": int(row["queued"]),
                        "scheduled": int(row["scheduled"]),
                        "running": int(row["running"]),
                        "failed": int(row["failed"]),
                        "oldest_age_seconds": (
                            max(0, int((current - oldest).total_seconds()))
                            if oldest is not None
                            else None
                        ),
                        "lease_overdue": int(row["lease_overdue"]),
                        "retry_attempts": int(row["retry_attempts"]),
                    }
            checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "error"
    finally:
        await engine.dispose()

    redis = Redis.from_url(settings.redis_url)
    try:
        async with asyncio.timeout(settings.worker_health_dependency_timeout_seconds):
            await cast(Awaitable[bool], redis.ping())
        checks["redis"] = "ok"
    except Exception:  # noqa: BLE001
        checks["redis"] = "error"
    finally:
        await redis.aclose()
    return checks, queues


async def check_health(mode: Literal["live", "ready"]) -> dict[str, Any]:
    settings = get_settings()
    state = load_runtime_state(settings.worker_health_state_path)
    dependencies: dict[str, str] | None = None
    queues: dict[str, dict[str, int | None]] | None = None
    if mode == "ready":
        dependencies, queues = await dependency_snapshot(settings)
    return build_health_report(
        mode,
        state,
        now=utc_now(),
        stale_after_seconds=settings.worker_health_stale_after_seconds,
        failure_threshold=settings.worker_health_failure_threshold,
        process_running=state is not None and _process_exists(state.pid),
        dependencies=dependencies,
        queues=queues,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Check Logion worker health")
    parser.add_argument("--live", action="store_true", help="check only process liveness")
    arguments = parser.parse_args()
    report = asyncio.run(check_health("live" if arguments.live else "ready"))
    print(json.dumps(report, separators=(",", ":")))
    if report["status"] not in {"ok", "ready"}:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
