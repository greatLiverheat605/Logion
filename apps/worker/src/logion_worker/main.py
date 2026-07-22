import asyncio
import json
import signal
from contextlib import suppress

from logion_api.ai_gateway.execution_service import AIExecutionService
from logion_api.config import get_settings
from logion_api.portability.deletion_service import AccountDeletionService
from logion_api.portability.service import PortabilityService
from logion_api.workspaces.service import WorkspaceService

from logion_worker.health import health_payload


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
    print(json.dumps({**health_payload(), "event": "worker_started"}))
    while not stop.is_set():
        try:
            handled = await portability.execute_next()
            if not handled:
                handled = await execution.execute_next()
            if not handled:
                handled = await deletion.execute_next()
        except Exception as exc:  # noqa: BLE001
            print(
                json.dumps(
                    {
                        **health_payload(),
                        "event": "worker_job_failed",
                        "error_type": type(exc).__name__,
                    }
                )
            )
            handled = False
        if not handled:
            with suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), timeout=1.0)
    print(json.dumps({**health_payload(), "event": "worker_stopped"}))


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
