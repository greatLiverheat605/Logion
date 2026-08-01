import asyncio
import json
import signal
from contextlib import suppress
from uuid import uuid4

from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.config import get_settings
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.service import WorkspaceService

from logion_worker.email_delivery import EmailDeliveryService
from logion_worker.health import WorkerHealthTracker, health_payload
from logion_worker.scheduler import QueueHandler, RoundRobinScheduler


async def maintain_heartbeat(
    stop: asyncio.Event,
    tracker: WorkerHealthTracker,
    interval_seconds: float = 5.0,
) -> None:
    while not stop.is_set():
        tracker.heartbeat()
        with suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=interval_seconds)


async def run_worker() -> None:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()

    def request_stop(_signum: int, _frame: object) -> None:
        loop.call_soon_threadsafe(stop.set)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    settings = get_settings()
    execution = AIExecutionService(settings)
    portability = PortabilityService(settings, WorkspaceService(settings))
    deletion = AccountDeletionService(settings)
    email_delivery = EmailDeliveryService(settings)
    tracker = WorkerHealthTracker(settings.worker_health_state_path)
    scheduler = RoundRobinScheduler(
        [
            QueueHandler("email", email_delivery.execute_next),
            QueueHandler("export", portability.execute_next),
            QueueHandler("ai", execution.execute_next),
            QueueHandler("deletion", deletion.execute_next),
        ]
    )
    heartbeat_task = asyncio.create_task(maintain_heartbeat(stop, tracker))
    print(
        json.dumps(
            {
                **health_payload(),
                "event": "worker_started",
                "queues": ["email", "export", "ai", "deletion"],
            }
        )
    )
    try:
        while not stop.is_set():
            poll_id = f"worker:{uuid4()}"
            try:
                handled_queue = await scheduler.execute_next()
                tracker.record_success(handled_queue, scheduler.successful_queues)
            except Exception as exc:  # noqa: BLE001
                tracker.record_failure(
                    scheduler.current_queue,
                    exc,
                    successful_queues=scheduler.successful_queues,
                )
                print(
                    json.dumps(
                        {
                            **health_payload(),
                            "event": "worker_job_failed",
                            "queue": scheduler.current_queue,
                            "stage": "execute_next",
                            "error_code": "WORKER_JOB_EXCEPTION",
                            "error_type": type(exc).__name__,
                            "correlation_id": poll_id,
                            "consecutive_failures": tracker.state.consecutive_failures,
                        }
                    )
                )
                handled_queue = None
            if handled_queue is None:
                with suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), timeout=1.0)
    finally:
        stop.set()
        await heartbeat_task
        tracker.record_stopped()
    print(json.dumps({**health_payload(), "event": "worker_stopped"}))


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
