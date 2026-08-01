from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class QueueHandler:
    name: str
    execute_next: Callable[[], Awaitable[bool]]


class RoundRobinScheduler:
    """Poll every queue from a rotating start point.

    The cursor advances before a handler runs, so a failing queue cannot keep
    later queues from being considered on the next cycle.
    """

    def __init__(self, handlers: Sequence[QueueHandler]) -> None:
        if not handlers:
            raise ValueError("at least one queue handler is required")
        names = [handler.name for handler in handlers]
        if len(names) != len(set(names)):
            raise ValueError("queue handler names must be unique")
        self._handlers = tuple(handlers)
        self._cursor = 0
        self.current_queue: str | None = None
        self.successful_queues: tuple[str, ...] = ()

    async def execute_next(self) -> str | None:
        start = self._cursor
        successful: list[str] = []
        self.successful_queues = ()
        for offset in range(len(self._handlers)):
            index = (start + offset) % len(self._handlers)
            handler = self._handlers[index]
            self.current_queue = handler.name
            self._cursor = (index + 1) % len(self._handlers)
            handled = await handler.execute_next()
            successful.append(handler.name)
            self.successful_queues = tuple(successful)
            if handled:
                return handler.name
        self.current_queue = None
        return None
