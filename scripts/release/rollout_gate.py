#!/usr/bin/env python3
"""Evaluate aggregate rollout samples without changing deployment or traffic state."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

POLICY_SCHEMA = "logion-rollout-policy-v1"
SAMPLES_SCHEMA = "logion-rollout-samples-v1"
EVIDENCE_SCHEMA = "logion-rollout-evidence-v1"
STAGES = (5, 25, 100)
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")
SAMPLE_KEYS = {
    "observed_at",
    "requests",
    "errors",
    "p95_ms",
    "health_ok",
    "queue_lag_seconds",
    "sync_failures",
    "sync_attempts",
}
POLICY_STAGE_KEYS = {
    "traffic_percent",
    "min_observation_seconds",
    "min_samples",
    "min_requests",
    "max_error_rate",
    "max_p95_ms",
    "max_queue_lag_seconds",
    "max_sync_failure_rate",
}


class RolloutError(ValueError):
    """Fail-closed rollout input or policy error."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RolloutError(f"cannot read JSON from {path}") from error
    if not isinstance(value, dict):
        raise RolloutError(f"{path} must contain a JSON object")
    return value


def digest(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def parse_time(value: object) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise RolloutError("observed_at must be an RFC3339 UTC timestamp")
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as error:
        raise RolloutError("observed_at must be an RFC3339 UTC timestamp") from error


def nonnegative_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        raise RolloutError(f"{name} must be a nonnegative number")
    return float(value)


def nonnegative_integer(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise RolloutError(f"{name} must be a nonnegative integer")
    return value


def stage_policy(policy: dict[str, Any], stage: int) -> dict[str, Any]:
    if policy.get("schema_version") != POLICY_SCHEMA:
        raise RolloutError("unsupported rollout policy schema")
    stages = policy.get("stages")
    if not isinstance(stages, list) or len(stages) != len(STAGES):
        raise RolloutError("policy must define exactly the 5, 25 and 100 percent stages")
    found: dict[int, dict[str, Any]] = {}
    for value in stages:
        if not isinstance(value, dict) or set(value) != POLICY_STAGE_KEYS:
            raise RolloutError("each rollout policy stage must match the exact schema")
        traffic = value.get("traffic_percent")
        if traffic not in STAGES or traffic in found:
            raise RolloutError("rollout policy stages must be unique 5, 25 and 100 values")
        for name in ("min_observation_seconds", "min_samples", "min_requests"):
            if nonnegative_integer(value[name], name) == 0:
                raise RolloutError(f"{name} must be greater than zero")
        for name in ("max_error_rate", "max_sync_failure_rate"):
            if nonnegative_number(value[name], name) > 1:
                raise RolloutError(f"{name} cannot exceed one")
        nonnegative_number(value["max_p95_ms"], "max_p95_ms")
        nonnegative_number(value["max_queue_lag_seconds"], "max_queue_lag_seconds")
        found[traffic] = value
    if tuple(sorted(found)) != STAGES:
        raise RolloutError("rollout policy stages must be 5, 25 and 100 percent")
    return found[stage]


def validate_previous(
    path: Path | None, *, stage: int, source_sha: str, mode: str
) -> str | None:
    previous_stage = {5: None, 25: 5, 100: 25}[stage]
    if previous_stage is None:
        if path is not None:
            raise RolloutError("5 percent evaluation must not provide previous evidence")
        return None
    if path is None:
        raise RolloutError(f"{stage} percent evaluation requires previous evidence")
    evidence = load_json(path)
    expected = {
        "schema_version": EVIDENCE_SCHEMA,
        "source_sha": source_sha,
        "mode": mode,
        "stage_percent": previous_stage,
        "decision": "promote",
    }
    for key, value in expected.items():
        if evidence.get(key) != value:
            raise RolloutError("previous evidence does not authorize this candidate stage")
    return digest(path)


def evaluate(
    policy_path: Path,
    samples_path: Path,
    *,
    stage: int,
    source_sha: str,
    mode: str,
    previous_path: Path | None = None,
) -> dict[str, Any]:
    if stage not in STAGES:
        raise RolloutError("stage must be 5, 25 or 100")
    if SHA_PATTERN.fullmatch(source_sha) is None:
        raise RolloutError("source SHA must contain 40 lowercase hexadecimal characters")
    if mode not in {"rehearsal", "production"}:
        raise RolloutError("mode must be rehearsal or production")

    policy = load_json(policy_path)
    selected = stage_policy(policy, stage)
    samples_document = load_json(samples_path)
    if samples_document.get("schema_version") != SAMPLES_SCHEMA:
        raise RolloutError("unsupported rollout sample schema")
    if samples_document.get("source_sha") != source_sha:
        raise RolloutError("samples belong to a different candidate")
    if samples_document.get("stage_percent") != stage:
        raise RolloutError("samples belong to a different rollout stage")
    sample_source = samples_document.get("sample_source")
    if sample_source not in {"synthetic_policy_rehearsal", "live_observability"}:
        raise RolloutError("sample_source is unsupported")
    if mode == "production" and sample_source != "live_observability":
        raise RolloutError("production decisions require live observability samples")
    previous_digest = validate_previous(
        previous_path, stage=stage, source_sha=source_sha, mode=mode
    )

    raw_samples = samples_document.get("samples")
    if not isinstance(raw_samples, list) or not raw_samples:
        raise RolloutError("at least one rollout sample is required")
    timestamps: list[datetime] = []
    total_requests = 0
    total_errors = 0
    total_sync_attempts = 0
    total_sync_failures = 0
    maximum_p95 = 0.0
    maximum_queue_lag = 0.0
    all_healthy = True
    for sample in raw_samples:
        if not isinstance(sample, dict) or set(sample) != SAMPLE_KEYS:
            raise RolloutError("rollout samples may contain only aggregate contract fields")
        timestamps.append(parse_time(sample["observed_at"]))
        requests = nonnegative_integer(sample["requests"], "requests")
        errors = nonnegative_integer(sample["errors"], "errors")
        sync_attempts = nonnegative_integer(sample["sync_attempts"], "sync_attempts")
        sync_failures = nonnegative_integer(sample["sync_failures"], "sync_failures")
        if errors > requests or sync_failures > sync_attempts:
            raise RolloutError("failure counts cannot exceed attempt counts")
        if not isinstance(sample["health_ok"], bool):
            raise RolloutError("health_ok must be a boolean")
        total_requests += requests
        total_errors += errors
        total_sync_attempts += sync_attempts
        total_sync_failures += sync_failures
        maximum_p95 = max(maximum_p95, nonnegative_number(sample["p95_ms"], "p95_ms"))
        maximum_queue_lag = max(
            maximum_queue_lag,
            nonnegative_number(sample["queue_lag_seconds"], "queue_lag_seconds"),
        )
        all_healthy = all_healthy and sample["health_ok"]
    if timestamps != sorted(timestamps) or len(set(timestamps)) != len(timestamps):
        raise RolloutError("sample timestamps must be unique and strictly ordered")

    observation_seconds = int((timestamps[-1] - timestamps[0]).total_seconds())
    error_rate = total_errors / total_requests if total_requests else 1.0
    sync_failure_rate = (
        total_sync_failures / total_sync_attempts if total_sync_attempts else 1.0
    )
    measured = {
        "samples": len(raw_samples),
        "observation_seconds": observation_seconds,
        "requests": total_requests,
        "errors": total_errors,
        "error_rate": error_rate,
        "maximum_reported_p95_ms": maximum_p95,
        "maximum_queue_lag_seconds": maximum_queue_lag,
        "sync_attempts": total_sync_attempts,
        "sync_failures": total_sync_failures,
        "sync_failure_rate": sync_failure_rate,
        "all_health_checks_passed": all_healthy,
    }
    insufficient = (
        len(raw_samples) < selected["min_samples"]
        or observation_seconds < selected["min_observation_seconds"]
        or total_requests < selected["min_requests"]
    )
    breached = (
        not all_healthy
        or error_rate > selected["max_error_rate"]
        or maximum_p95 > selected["max_p95_ms"]
        or maximum_queue_lag > selected["max_queue_lag_seconds"]
        or sync_failure_rate > selected["max_sync_failure_rate"]
    )
    if breached:
        decision = "abort"
    elif insufficient:
        decision = "hold"
    else:
        decision = "complete" if stage == 100 else "promote"
    return {
        "schema_version": EVIDENCE_SCHEMA,
        "source_sha": source_sha,
        "mode": mode,
        "sample_source": sample_source,
        "stage_percent": stage,
        "decision": decision,
        "policy_sha256": digest(policy_path),
        "samples_sha256": digest(samples_path),
        "previous_evidence_sha256": previous_digest,
        "thresholds": selected,
        "measured": measured,
        "changes_traffic": False,
        "production_approval_granted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--samples", type=Path, required=True)
    parser.add_argument("--stage", type=int, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--mode", choices=("rehearsal", "production"), required=True)
    parser.add_argument("--previous-evidence", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = evaluate(
            args.policy,
            args.samples,
            stage=args.stage,
            source_sha=args.source_sha,
            mode=args.mode,
            previous_path=args.previous_evidence,
        )
    except (OSError, RolloutError, KeyError, TypeError) as error:
        print(f"rollout gate rejected input: {error}", file=sys.stderr)
        return 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, sort_keys=True))
    return {"promote": 0, "complete": 0, "hold": 3, "abort": 4}[result["decision"]]


if __name__ == "__main__":
    raise SystemExit(main())
