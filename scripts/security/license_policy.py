"""Apply the Logion production dependency license policy."""

from __future__ import annotations

import argparse
import json
from importlib.metadata import Distribution, distributions
from pathlib import Path
from typing import Any


class LicensePolicyError(ValueError):
    """Dependency license evidence is missing, malformed, or not approved."""


def load_policy(path: Path) -> dict[str, Any]:
    policy = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(policy, dict) or policy.get("schema_version") != 1:
        raise LicensePolicyError("unsupported license policy")
    for field in ("allowed_licenses", "internal_packages", "classifier_licenses"):
        if field not in policy:
            raise LicensePolicyError(f"license policy is missing {field}")
    return policy


def python_packages(items: list[Distribution] | None = None) -> list[dict[str, str]]:
    packages: list[dict[str, str]] = []
    for distribution in items if items is not None else list(distributions()):
        name = distribution.metadata.get("Name")
        if not name:
            continue
        license_value = (
            distribution.metadata.get("License-Expression")
            or distribution.metadata.get("License")
            or ""
        ).strip()
        classifiers = distribution.metadata.get_all("Classifier") or []
        packages.append(
            {
                "name": name,
                "version": distribution.version,
                "license": license_value,
                "classifiers": "\n".join(classifiers),
            }
        )
    return sorted(packages, key=lambda item: (item["name"].casefold(), item["version"]))


def pnpm_packages(value: object) -> list[dict[str, str]]:
    if not isinstance(value, dict):
        raise LicensePolicyError("pnpm license report must be an object")
    packages: list[dict[str, str]] = []
    for group_license, entries in value.items():
        if not isinstance(group_license, str) or not isinstance(entries, list):
            raise LicensePolicyError("invalid pnpm license group")
        for entry in entries:
            if not isinstance(entry, dict):
                raise LicensePolicyError("invalid pnpm package entry")
            name = entry.get("name")
            versions = entry.get("versions")
            license_value = entry.get("license", group_license)
            if (
                not isinstance(name, str)
                or not isinstance(versions, list)
                or not all(isinstance(version, str) for version in versions)
                or not isinstance(license_value, str)
            ):
                raise LicensePolicyError("pnpm package metadata is incomplete")
            packages.extend(
                {"name": name, "version": version, "license": license_value, "classifiers": ""}
                for version in versions
            )
    return sorted(packages, key=lambda item: (item["name"].casefold(), item["version"]))


def evaluate(
    *,
    policy: dict[str, Any],
    node_packages: list[dict[str, str]],
    py_packages: list[dict[str, str]],
) -> dict[str, Any]:
    allowed = set(policy["allowed_licenses"])
    internal = set(policy["internal_packages"])
    classifier_licenses = policy["classifier_licenses"]
    results: list[dict[str, str]] = []
    denied: list[str] = []
    for ecosystem, packages in (("node", node_packages), ("python", py_packages)):
        for package in packages:
            license_value = package["license"].strip()
            if package["name"] in internal:
                license_value = "INTERNAL"
            if not license_value:
                for classifier, mapped_license in classifier_licenses.items():
                    if classifier in package.get("classifiers", "").splitlines():
                        license_value = mapped_license
                        break
            approved = license_value == "INTERNAL" or license_value in allowed
            results.append(
                {
                    "ecosystem": ecosystem,
                    "name": package["name"],
                    "version": package["version"],
                    "license": license_value or "UNKNOWN",
                    "status": "approved" if approved else "denied",
                }
            )
            if not approved:
                denied.append(
                    f"{ecosystem}:{package['name']}@{package['version']}="
                    f"{license_value or 'UNKNOWN'}"
                )
    return {
        "schema_version": 1,
        "packages": results,
        "denied": denied,
        "passed": not denied,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--pnpm-json", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = evaluate(
            policy=load_policy(args.policy),
            node_packages=pnpm_packages(
                json.loads(args.pnpm_json.read_text(encoding="utf-8-sig"))
            ),
            py_packages=python_packages(),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        if not report["passed"]:
            raise LicensePolicyError(
                "unapproved dependency licenses: " + ", ".join(report["denied"])
            )
    except (LicensePolicyError, json.JSONDecodeError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
