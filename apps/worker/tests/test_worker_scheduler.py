import pytest
from logion_worker.scheduler import QueueHandler, RoundRobinScheduler


def handler(name: str, calls: list[str], *, handled: bool = True) -> QueueHandler:
    async def execute_next() -> bool:
        calls.append(name)
        return handled

    return QueueHandler(name, execute_next)


@pytest.mark.asyncio
async def test_scheduler_rotates_busy_queues_without_starvation() -> None:
    calls: list[str] = []
    scheduler = RoundRobinScheduler(
        [handler(name, calls) for name in ("email", "export", "ai", "deletion")]
    )

    handled = [await scheduler.execute_next() for _ in range(8)]

    assert handled == ["email", "export", "ai", "deletion"] * 2
    assert calls == handled


@pytest.mark.asyncio
async def test_scheduler_checks_later_queues_and_rotates_empty_start() -> None:
    calls: list[str] = []
    scheduler = RoundRobinScheduler(
        [
            handler("email", calls, handled=False),
            handler("export", calls, handled=True),
            handler("ai", calls, handled=False),
        ]
    )

    assert await scheduler.execute_next() == "export"
    assert await scheduler.execute_next() == "export"
    assert calls == ["email", "export", "ai", "email", "export"]


@pytest.mark.asyncio
async def test_scheduler_advances_past_a_failing_queue() -> None:
    calls: list[str] = []

    async def fail() -> bool:
        calls.append("email")
        raise RuntimeError("safe test failure")

    scheduler = RoundRobinScheduler(
        [QueueHandler("email", fail), handler("export", calls, handled=True)]
    )

    with pytest.raises(RuntimeError):
        await scheduler.execute_next()
    assert scheduler.successful_queues == ()
    assert await scheduler.execute_next() == "export"
    assert calls == ["email", "export"]
