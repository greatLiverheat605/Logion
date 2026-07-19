from logion_worker.health import health_payload


def test_worker_health_payload() -> None:
    assert health_payload() == {"status": "ok", "service": "worker", "version": "0.1.0"}
