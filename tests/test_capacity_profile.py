import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "capacity_profile", ROOT / "scripts/performance/capacity_profile.py"
)
assert SPEC is not None and SPEC.loader is not None
capacity_profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capacity_profile)


def test_percentile_uses_nearest_rank() -> None:
    values = [float(value) for value in range(1, 101)]
    assert capacity_profile.percentile(values, 50) == 50
    assert capacity_profile.percentile(values, 95) == 95
    assert capacity_profile.percentile(values, 99) == 99


def test_capacity_database_must_be_dedicated() -> None:
    assert (
        capacity_profile.database_url(
            "postgresql+asyncpg://logion:secret@localhost:5432/logion_capacity"
        )
        == "postgresql://logion:secret@localhost:5432/logion_capacity"
    )
    with pytest.raises(ValueError, match="dedicated database"):
        capacity_profile.database_url("postgresql+asyncpg://logion:secret@localhost:5432/logion")


def test_mandatory_counts_match_the_release_baseline() -> None:
    assert capacity_profile.EXPECTED_COUNTS == {
        "tasks": 100_000,
        "events": 1_000_000,
        "notes": 25_000,
        "resources": 25_000,
        "attachments": 10_000,
        "papers": 5_000,
        "ai_runs": 100_000,
    }
