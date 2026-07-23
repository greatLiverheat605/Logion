"""Verify candidate provenance and run repository, image, and IaC security scans."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

SERVICES = ("api", "backup", "web", "worker")
IMAGE_RE = re.compile(
    r"^ghcr\.io/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9][a-z0-9._/-]*@"
    r"sha256:[0-9a-f]{64}$"
)
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
Runner = Callable[[Sequence[str]], int]


class CandidateSecurityError(ValueError):
    """The candidate security request is malformed or a gate failed."""


def parse_images(values: list[str]) -> dict[str, str]:
    images: dict[str, str] = {}
    for value in values:
        service, separator, reference = value.partition("=")
        if (
            not separator
            or service not in SERVICES
            or service in images
            or not IMAGE_RE.fullmatch(reference)
        ):
            raise CandidateSecurityError(f"invalid digest-pinned image assignment: {value}")
        images[service] = reference
    if set(images) != set(SERVICES):
        raise CandidateSecurityError(f"images must contain exactly: {', '.join(SERVICES)}")
    return dict(sorted(images.items()))


def _default_runner(command: Sequence[str]) -> int:
    try:
        return subprocess.run(command, check=False).returncode  # noqa: S603
    except FileNotFoundError as exc:
        raise CandidateSecurityError(f"required executable is unavailable: {command[0]}") from exc


def execute_gates(
    *,
    root: Path,
    reports_dir: Path,
    repository: str,
    images: dict[str, str],
    verify_attestations: bool,
    runner: Runner = _default_runner,
) -> dict[str, Any]:
    if not REPOSITORY_RE.fullmatch(repository):
        raise CandidateSecurityError("repository must use owner/name format")
    reports_dir.mkdir(parents=True, exist_ok=True)
    sarif_dir = reports_dir / "sarif"
    sarif_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, str | int | bool]] = []

    def run_gate(name: str, command: list[str], output: Path | None = None) -> None:
        return_code = runner(command)
        results.append(
            {
                "name": name,
                "passed": return_code == 0,
                "return_code": return_code,
                "report": str(output.relative_to(reports_dir)) if output is not None else "",
            }
        )

    if verify_attestations:
        for service, reference in images.items():
            run_gate(
                f"attestation:{service}",
                ["gh", "attestation", "verify", f"oci://{reference}", "--repo", repository],
            )

    for service, reference in images.items():
        output = sarif_dir / f"image-{service}.sarif"
        run_gate(
            f"image:{service}",
            [
                "trivy",
                "image",
                "--scanners",
                "vuln,secret",
                "--severity",
                "HIGH,CRITICAL",
                "--format",
                "sarif",
                "--output",
                str(output),
                "--exit-code",
                "1",
                reference,
            ],
            output,
        )

    for scan_type, scanners in (("filesystem", "vuln,secret"), ("iac", "misconfig")):
        output = sarif_dir / f"{scan_type}.sarif"
        trivy_command = "fs" if scan_type == "filesystem" else "config"
        command = ["trivy", trivy_command]
        if trivy_command == "fs":
            command.extend(["--scanners", scanners])
        command.extend(
            [
                "--severity",
                "HIGH,CRITICAL",
                "--format",
                "sarif",
                "--output",
                str(output),
                "--exit-code",
                "1",
                str(root),
            ]
        )
        run_gate(scan_type, command, output)

    summary = {
        "schema_version": 1,
        "repository": repository,
        "images": {service: reference for service, reference in images.items()},
        "gates": results,
        "passed": all(bool(result["passed"]) for result in results),
    }
    (reports_dir / "candidate-security-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    if not summary["passed"]:
        failed = ", ".join(str(result["name"]) for result in results if not result["passed"])
        raise CandidateSecurityError(f"candidate security gates failed: {failed}")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--reports-dir", type=Path, required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--verify-attestations", action="store_true")
    args = parser.parse_args()
    try:
        execute_gates(
            root=args.root.resolve(),
            reports_dir=args.reports_dir.resolve(),
            repository=args.repository,
            images=parse_images(args.image),
            verify_attestations=args.verify_attestations,
        )
    except (CandidateSecurityError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
