"""Run a bounded authenticated non-AI API latency gate."""

from __future__ import annotations

import argparse
import json
import math
import os
import time
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

FIXTURE_EMAIL_ENV = "LOGION_PERFORMANCE_FIXTURE_EMAIL"
FIXTURE_CREDENTIAL_ENV = "LOGION_PERFORMANCE_FIXTURE_PASSWORD"


class PerformanceGateError(RuntimeError):
    """The performance smoke could not produce valid passing evidence."""


def fixture_credentials(environ: Mapping[str, str]) -> tuple[str, str]:
    email = environ.get(FIXTURE_EMAIL_ENV, "").strip()
    password = environ.get(FIXTURE_CREDENTIAL_ENV, "")
    if not email or not password:
        raise PerformanceGateError(
            f"{FIXTURE_EMAIL_ENV} and {FIXTURE_CREDENTIAL_ENV} are required"
        )
    return email, password


def percentile(values: list[float], percentage: int) -> float:
    if not values or percentage < 1 or percentage > 100:
        raise ValueError("percentile requires values and a percentage from 1 to 100")
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * percentage / 100) - 1)
    return ordered[index]


def summarize(
    latencies_ms: list[float],
    *,
    request_count: int,
    concurrency: int,
    threshold_ms: float,
) -> dict[str, float | int | bool]:
    if len(latencies_ms) != request_count:
        raise PerformanceGateError("not all benchmark requests completed successfully")
    p95 = percentile(latencies_ms, 95)
    return {
        "requests": request_count,
        "concurrency": concurrency,
        "p50_ms": round(percentile(latencies_ms, 50), 2),
        "p95_ms": round(p95, 2),
        "p99_ms": round(percentile(latencies_ms, 99), 2),
        "max_ms": round(max(latencies_ms), 2),
        "threshold_p95_ms": threshold_ms,
        "passed": p95 < threshold_ms,
    }


def run_gate(
    base_url: str,
    *,
    fixture_email: str,
    fixture_password: str,
    request_count: int,
    concurrency: int,
    threshold_ms: float,
) -> dict[str, Any]:
    if request_count < 20 or request_count > 5_000:
        raise PerformanceGateError("requests must be between 20 and 5000")
    if concurrency < 1 or concurrency > min(100, request_count):
        raise PerformanceGateError("concurrency is outside the safe bounded range")
    if threshold_ms <= 0:
        raise PerformanceGateError("threshold must be positive")

    origin = "http://localhost:3000"
    with httpx.Client(base_url=base_url, timeout=10, headers={"Origin": origin}) as client:
        login = client.post(
            "/api/v1/auth/login",
            json={
                "email": fixture_email,
                "password": fixture_password,
                "device_name": "Phase 6 performance gate",
                "platform": "web",
            },
        )
        if login.status_code != 200:
            raise PerformanceGateError(f"fixture login failed with HTTP {login.status_code}")

        endpoint = "/api/v1/workspaces"
        warmup = client.get(endpoint)
        if warmup.status_code != 200:
            raise PerformanceGateError(f"warmup failed with HTTP {warmup.status_code}")

        def request_once(_: int) -> float:
            started = time.perf_counter()
            response = client.get(endpoint)
            elapsed_ms = (time.perf_counter() - started) * 1000
            if response.status_code != 200:
                raise PerformanceGateError(f"request failed with HTTP {response.status_code}")
            return elapsed_ms

        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            latencies = list(executor.map(request_once, range(request_count)))
        duration_ms = (time.perf_counter() - started) * 1000

    metrics = summarize(
        latencies,
        request_count=request_count,
        concurrency=concurrency,
        threshold_ms=threshold_ms,
    )
    evidence: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "scenario": "authenticated-workspace-list",
        "endpoint": endpoint,
        "fixture": {"users": 1, "workspaces": 1},
        "duration_ms": round(duration_ms, 2),
        "metrics": metrics,
        "limitations": [
            "bounded candidate smoke; not the full release capacity profile",
            "runner and network placement must be recorded with full RC evidence",
        ],
    }
    if not metrics["passed"]:
        raise PerformanceGateError(
            f"p95 {metrics['p95_ms']} ms did not meet the < {threshold_ms} ms gate"
        )
    return evidence


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--threshold-ms", type=float, default=500)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        fixture_email, fixture_password = fixture_credentials(os.environ)
        evidence = run_gate(
            args.base_url.rstrip("/"),
            fixture_email=fixture_email,
            fixture_password=fixture_password,
            request_count=args.requests,
            concurrency=args.concurrency,
            threshold_ms=args.threshold_ms,
        )
    except (PerformanceGateError, httpx.HTTPError) as exc:
        parser.error(str(exc))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
