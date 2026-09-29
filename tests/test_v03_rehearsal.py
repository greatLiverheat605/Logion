"""The migration rehearsal must reject non-isolated targets before connecting."""

import runpy
from pathlib import Path

import pytest

MODULE = runpy.run_path(
    str(Path(__file__).resolve().parents[1] / "scripts/release/rehearse_v03.py")
)


@pytest.mark.parametrize(
    "value",
    [
        "postgresql://127.0.0.1:5432/logion",
        "postgresql://db.example.invalid/logion_rehearsal",
        "postgresql://localhost/logion_rehearsal?host=db.example.invalid",
        "postgresql://127.0.0.1.evil.invalid/logion_rehearsal",
        "postgresql:///logion_rehearsal",
        "mysql://127.0.0.1/logion_rehearsal",
    ],
)
def test_migration_rehearsal_rejects_unsafe_target(value: str) -> None:
    with pytest.raises(ValueError, match="loopback database"):
        MODULE["local_database"](value)


def test_rehearsal_accepts_named_local_copy_and_quotes_catalog_identifiers() -> None:
    assert (
        MODULE["local_database"]("postgresql+asyncpg://127.0.0.1:55431/r5_capacity")
        == "postgresql://127.0.0.1:55431/r5_capacity"
    )
    assert MODULE["identifier"]('a"b') == '"a""b"'


def test_synthetic_environment_does_not_inherit_integration_credentials(monkeypatch) -> None:
    monkeypatch.setenv("LOGION_INTEGRATION_KEYRING", "not-a-real-keyring")
    env = MODULE["synthetic_environment"]("postgresql://localhost/r5_capacity")
    assert "LOGION_INTEGRATION_KEYRING" not in env
    assert env["LOGION_ENV"] == "test"
    assert env["LOGION_DATABASE_URL"] == "postgresql+asyncpg://localhost/r5_capacity"


@pytest.mark.parametrize(
    "value",
    [
        "redis://127.0.0.1/0",
        "redis://remote.example.invalid/1",
        "redis://127.0.0.1/1?db=0",
        "redis://127.0.0.1/1#other",
    ],
)
def test_rehearsal_rejects_shared_or_remote_redis(value: str) -> None:
    with pytest.raises(ValueError, match="dedicated nonzero loopback"):
        MODULE["local_redis"](value)


def test_rehearsal_accepts_dedicated_local_redis() -> None:
    assert MODULE["local_redis"]("redis://127.0.0.1:6380/15") == "redis://127.0.0.1:6380/15"
