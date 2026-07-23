import copy
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "rollout_gate", ROOT / "scripts/release/rollout_gate.py"
)
assert SPEC is not None and SPEC.loader is not None
rollout_gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rollout_gate)

SOURCE_SHA = "a" * 40
POLICY = ROOT / "config/release/rollout-policy.json"
FIXTURES = ROOT / "tests/fixtures/release"


def fixture(stage: int) -> dict[str, object]:
    return json.loads((FIXTURES / f"rollout-{stage}.json").read_text(encoding="utf-8"))


def write_json(path: Path, value: object) -> Path:
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def evaluate(tmp_path: Path, stage: int, *, previous: Path | None = None) -> dict[str, object]:
    samples = write_json(tmp_path / f"samples-{stage}.json", fixture(stage))
    return rollout_gate.evaluate(
        POLICY,
        samples,
        stage=stage,
        source_sha=SOURCE_SHA,
        mode="rehearsal",
        previous_path=previous,
    )


def evidence(path: Path, value: dict[str, object]) -> Path:
    return write_json(path, value)


def test_rehearsal_requires_ordered_evidence_and_completes(tmp_path: Path) -> None:
    stage5 = evaluate(tmp_path, 5)
    assert stage5["decision"] == "promote"
    stage5_path = evidence(tmp_path / "stage-5.json", stage5)
    stage25 = evaluate(tmp_path, 25, previous=stage5_path)
    assert stage25["decision"] == "promote"
    stage25_path = evidence(tmp_path / "stage-25.json", stage25)
    stage100 = evaluate(tmp_path, 100, previous=stage25_path)
    assert stage100["decision"] == "complete"
    assert stage100["changes_traffic"] is False
    assert stage100["production_approval_granted"] is False


def test_insufficient_observation_holds(tmp_path: Path) -> None:
    value = fixture(5)
    samples = value["samples"]
    assert isinstance(samples, list)
    samples[-1]["observed_at"] = "2026-07-23T00:10:00Z"
    path = write_json(tmp_path / "hold.json", value)
    result = rollout_gate.evaluate(
        POLICY, path, stage=5, source_sha=SOURCE_SHA, mode="rehearsal"
    )
    assert result["decision"] == "hold"


def test_unhealthy_sample_aborts(tmp_path: Path) -> None:
    value = fixture(5)
    samples = value["samples"]
    assert isinstance(samples, list)
    samples[1]["health_ok"] = False
    path = write_json(tmp_path / "abort.json", value)
    result = rollout_gate.evaluate(
        POLICY, path, stage=5, source_sha=SOURCE_SHA, mode="rehearsal"
    )
    assert result["decision"] == "abort"


def test_rejects_content_fields_and_synthetic_production_samples(tmp_path: Path) -> None:
    value = fixture(5)
    samples = value["samples"]
    assert isinstance(samples, list)
    samples[0]["note_title"] = "must not enter observability"
    path = write_json(tmp_path / "content.json", value)
    with pytest.raises(rollout_gate.RolloutError, match="aggregate contract fields"):
        rollout_gate.evaluate(
            POLICY, path, stage=5, source_sha=SOURCE_SHA, mode="rehearsal"
        )

    production = write_json(tmp_path / "production.json", fixture(5))
    with pytest.raises(rollout_gate.RolloutError, match="live observability"):
        rollout_gate.evaluate(
            POLICY, production, stage=5, source_sha=SOURCE_SHA, mode="production"
        )


def test_rejects_cross_candidate_previous_evidence(tmp_path: Path) -> None:
    stage5 = evaluate(tmp_path, 5)
    foreign = copy.deepcopy(stage5)
    foreign["source_sha"] = "b" * 40
    previous = evidence(tmp_path / "foreign.json", foreign)
    with pytest.raises(rollout_gate.RolloutError, match="does not authorize"):
        evaluate(tmp_path, 25, previous=previous)
