import json
import signal
from threading import Event

from logion_worker.health import health_payload


def main() -> None:
    """Keep the Phase 0 worker process observable without executing business jobs."""

    stop = Event()

    def request_stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    print(json.dumps({**health_payload(), "event": "worker_started"}))
    stop.wait()
    print(json.dumps({**health_payload(), "event": "worker_stopped"}))


if __name__ == "__main__":
    main()
