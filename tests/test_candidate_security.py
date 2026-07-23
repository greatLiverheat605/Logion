import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "candidate_security", ROOT / "scripts/security/candidate_security.py"
)
assert SPEC is not None and SPEC.loader is not None
candidate_security = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate_security)


def image_values() -> list[str]:
    return [
        f"{service}=ghcr.io/greatliverheat605/logion-{service}@sha256:{index:064x}"
        for index, service in enumerate(candidate_security.SERVICES, start=1)
    ]


def test_security_gates_verify_all_attestations_images_source_and_iac(tmp_path: Path) -> None:
    commands: list[list[str]] = []

    def runner(command: list[str]) -> int:
        commands.append(command)
        return 0

    summary = candidate_security.execute_gates(
        root=ROOT,
        reports_dir=tmp_path,
        repository="greatLiverheat605/Logion",
        images=candidate_security.parse_images(image_values()),
        verify_attestations=True,
        runner=runner,
    )

    assert summary["passed"] is True
    assert len(commands) == 10
    assert sum(command[:3] == ["gh", "attestation", "verify"] for command in commands) == 4
    assert sum(command[:2] == ["trivy", "image"] for command in commands) == 4
    assert [command[:2] for command in commands[-2:]] == [["trivy", "fs"], ["trivy", "config"]]


def test_security_gates_collect_failures_and_reject_candidate(tmp_path: Path) -> None:
    calls = 0

    def runner(_: list[str]) -> int:
        nonlocal calls
        calls += 1
        return 1 if calls in {2, 8} else 0

    with pytest.raises(candidate_security.CandidateSecurityError, match="attestation:backup"):
        candidate_security.execute_gates(
            root=ROOT,
            reports_dir=tmp_path,
            repository="greatLiverheat605/Logion",
            images=candidate_security.parse_images(image_values()),
            verify_attestations=True,
            runner=runner,
        )
    summary = (tmp_path / "candidate-security-summary.json").read_text(encoding="utf-8")
    assert '"passed": false' in summary
    assert calls == 10


def test_security_gates_reject_mutable_or_incomplete_images() -> None:
    with pytest.raises(candidate_security.CandidateSecurityError):
        candidate_security.parse_images(
            ["api=ghcr.io/greatliverheat605/logion-api:latest"]
        )
