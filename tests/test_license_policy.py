import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "license_policy", ROOT / "scripts/security/license_policy.py"
)
assert SPEC is not None and SPEC.loader is not None
license_policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(license_policy)


def package(name: str, license_value: str, classifiers: str = "") -> dict[str, str]:
    return {
        "name": name,
        "version": "1.0.0",
        "license": license_value,
        "classifiers": classifiers,
    }


def test_license_policy_accepts_allowed_internal_and_classifier_mapped_packages() -> None:
    policy = license_policy.load_policy(ROOT / "config/security/license-policy.json")
    report = license_policy.evaluate(
        policy=policy,
        node_packages=[package("frontend", "MIT"), package("libvips", "LGPL-3.0-or-later")],
        py_packages=[
            package("logion-api", ""),
            package("uvloop", "MIT License"),
            package("library", "", "License :: OSI Approved :: Apache Software License"),
        ],
    )

    assert report["passed"] is True
    assert report["denied"] == []


def test_license_policy_fails_closed_for_unknown_and_unapproved_licenses() -> None:
    policy = license_policy.load_policy(ROOT / "config/security/license-policy.json")
    report = license_policy.evaluate(
        policy=policy,
        node_packages=[package("unknown", "")],
        py_packages=[package("strong-copyleft", "AGPL-3.0-only")],
    )

    assert report["passed"] is False
    assert report["denied"] == [
        "node:unknown@1.0.0=UNKNOWN",
        "python:strong-copyleft@1.0.0=AGPL-3.0-only",
    ]
