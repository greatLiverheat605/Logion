from unittest.mock import AsyncMock, MagicMock

import pytest
from logion_api.identity import device_hygiene


@pytest.mark.asyncio
async def test_hygiene_drains_bounded_batches_then_polls_without_blocking(monkeypatch):
    db = AsyncMock()
    factory = MagicMock()
    factory.return_value.__aenter__.return_value = db
    execute = AsyncMock(side_effect=[100, 1, 0])
    tick = 1000.0
    monkeypatch.setattr(device_hygiene, "session_factory", factory)
    monkeypatch.setattr(device_hygiene, "revoke_inactive_devices", execute)
    monkeypatch.setattr(device_hygiene, "monotonic", lambda: tick)
    service = device_hygiene.DeviceHygieneService()
    assert await service.execute_next() is True
    assert await service.execute_next() is True
    assert await service.execute_next() is False
    assert execute.await_count == 2
    assert db.commit.await_count == 2
    tick += 899
    assert await service.execute_next() is False
    assert execute.await_count == 2
    tick += 1
    assert await service.execute_next() is False
    assert execute.await_count == 3
    assert db.commit.await_count == 3
