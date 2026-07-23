import importlib.util
from pathlib import Path

import pytest
from email_validator import validate_email

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "api_smoke", ROOT / "scripts/performance/api_smoke.py"
)
assert SPEC is not None and SPEC.loader is not None
api_smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api_smoke)


def test_percentile_uses_nearest_rank() -> None:
    assert api_smoke.percentile([float(value) for value in range(1, 101)], 95) == 95


def test_summary_enforces_complete_sample_and_strict_threshold() -> None:
    summary = api_smoke.summarize(
        [10.0] * 19 + [499.0], request_count=20, concurrency=2, threshold_ms=500
    )
    assert summary["passed"] is True
    assert summary["p95_ms"] == 10.0

    with pytest.raises(api_smoke.PerformanceGateError):
        api_smoke.summarize([10.0], request_count=2, concurrency=1, threshold_ms=500)


def test_summary_fails_when_p95_equals_threshold() -> None:
    summary = api_smoke.summarize(
        [500.0] * 20, request_count=20, concurrency=2, threshold_ms=500
    )
    assert summary["passed"] is False


def test_performance_fixture_uses_an_email_validator_compatible_domain() -> None:
    result = validate_email(
        f"performance@{api_smoke.FIXTURE_EMAIL_DOMAIN}",
        check_deliverability=False,
    )
    assert result.normalized == "performance@example.com"
