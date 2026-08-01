from datetime import UTC, datetime, timedelta

from logion_worker.health import (
    WorkerHealthTracker,
    build_health_report,
    health_payload,
    load_runtime_state,
)

NOW = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)


def test_worker_log_health_payload_stays_minimal() -> None:
    assert health_payload() == {"status": "ok", "service": "worker", "version": "0.1.0"}


def test_tracker_persists_success_and_sanitized_failure_state(tmp_path) -> None:
    path = tmp_path / "worker-health.json"
    tracker = WorkerHealthTracker(path, NOW)
    tracker.record_success("email", ("email",), NOW + timedelta(seconds=1))
    tracker.record_failure(
        "export", RuntimeError("must not be persisted"), now=NOW + timedelta(seconds=2)
    )

    state = load_runtime_state(path)

    assert state is not None
    assert state.last_successful_poll_at == (NOW + timedelta(seconds=1)).isoformat()
    assert state.consecutive_failures == 1
    assert state.last_queue == "export"
    assert state.last_error_type == "RuntimeError"
    assert state.last_error_code == "WORKER_JOB_EXCEPTION"
    assert "must not be persisted" not in path.read_text(encoding="utf-8")


def test_readiness_fails_after_consecutive_failure_threshold(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)
    tracker.record_success(None, ("email", "export", "ai", "deletion"), NOW)
    for offset in range(3):
        tracker.record_failure("ai", RuntimeError("failure"), now=NOW + timedelta(seconds=offset))

    report = build_health_report(
        "ready",
        tracker.state,
        now=NOW + timedelta(seconds=3),
        stale_after_seconds=15,
        failure_threshold=3,
        process_running=True,
        dependencies={"database": "ok", "redis": "ok"},
        queues={"ai": {"depth": 2, "oldest_age_seconds": 30}},
    )

    assert report["status"] == "not_ready"
    assert report["checks"]["consecutive_failures"] == "error"
    assert report["queues"]["ai"] == {"depth": 2, "oldest_age_seconds": 30}


def test_successful_poll_recovers_readiness(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)
    tracker.record_failure("email", RuntimeError("failure"), now=NOW)
    tracker.record_success("email", ("email",), NOW + timedelta(seconds=1))

    report = build_health_report(
        "ready",
        tracker.state,
        now=NOW + timedelta(seconds=2),
        stale_after_seconds=15,
        failure_threshold=3,
        process_running=True,
        dependencies={"database": "ok", "redis": "ok"},
    )

    assert report["status"] == "ready"
    assert report["consecutive_failures"] == 0
    assert report["last_error_type"] is None


def test_stale_heartbeat_and_dependency_failure_are_not_ready(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)
    tracker.record_success(None, ("email", "export", "ai", "deletion"), NOW)

    report = build_health_report(
        "ready",
        tracker.state,
        now=NOW + timedelta(seconds=16),
        stale_after_seconds=15,
        failure_threshold=3,
        process_running=True,
        dependencies={"database": "ok", "redis": "error"},
    )

    assert report["status"] == "not_ready"
    assert report["checks"]["heartbeat"] == "error"
    assert report["checks"]["redis"] == "error"


def test_liveness_distinguishes_a_stopped_process(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)
    tracker.record_stopped(NOW + timedelta(seconds=1))

    report = build_health_report(
        "live",
        tracker.state,
        now=NOW + timedelta(seconds=2),
        stale_after_seconds=15,
        failure_threshold=3,
        process_running=False,
    )

    assert report["status"] == "error"


def test_other_queue_success_does_not_hide_repeated_queue_failures(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)

    for offset in range(3):
        tracker.record_success(
            "email",
            ("email",),
            NOW + timedelta(seconds=offset * 2),
        )
        tracker.record_failure(
            "export",
            RuntimeError("failure"),
            now=NOW + timedelta(seconds=offset * 2 + 1),
        )

    assert tracker.state.consecutive_failures == 3
    assert tracker.state.queue_failures == {"email": 0, "export": 3}


def test_heartbeat_does_not_clear_queue_failures(tmp_path) -> None:
    tracker = WorkerHealthTracker(tmp_path / "worker-health.json", NOW)
    tracker.record_failure("ai", RuntimeError("failure"), now=NOW)

    tracker.heartbeat(NOW + timedelta(seconds=5))

    assert tracker.state.heartbeat_at == (NOW + timedelta(seconds=5)).isoformat()
    assert tracker.state.queue_failures == {"ai": 1}
    assert tracker.state.consecutive_failures == 1
