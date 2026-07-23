import copy
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "candidate_manifest", ROOT / "scripts/release/candidate_manifest.py"
)
assert SPEC is not None and SPEC.loader is not None
candidate_manifest = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate_manifest)

COMMIT = "a" * 40
GENERATED_AT = "2026-07-23T08:00:00Z"
REPOSITORY = "greatLiverheat605/Logion"


def images() -> dict[str, dict[str, str]]:
    return candidate_manifest.parse_images(
        [
            f"{service}=ghcr.io/greatliverheat605/logion-{service}@sha256:{index:064x}"
            for index, service in enumerate(candidate_manifest.SERVICES, start=1)
        ]
    )


def test_manifest_captures_current_compatibility_and_verifies() -> None:
    manifest = candidate_manifest.build_manifest(ROOT, COMMIT, REPOSITORY, images(), GENERATED_AT)

    assert manifest["compatibility"] == {
        "migration_head": "0031_account_deletion",
        "sync_protocol": "sync-v1",
        "offline_schema": 3,
    }
    assert manifest["application_version"] == "0.1.0"
    candidate_manifest.verify_manifest(ROOT, manifest, COMMIT, REPOSITORY)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source", {"repository": REPOSITORY, "commit": "b" * 40}),
        ("application_version", "9.9.9"),
        ("compatibility", {"migration_head": "wrong"}),
        ("artifacts", {}),
    ],
)
def test_verification_rejects_tampered_source_metadata(field: str, value: object) -> None:
    manifest = candidate_manifest.build_manifest(ROOT, COMMIT, REPOSITORY, images(), GENERATED_AT)
    manifest[field] = value

    with pytest.raises(candidate_manifest.ManifestError):
        candidate_manifest.verify_manifest(ROOT, manifest, COMMIT, REPOSITORY)


def test_verification_rejects_reference_digest_mismatch() -> None:
    manifest = candidate_manifest.build_manifest(ROOT, COMMIT, REPOSITORY, images(), GENERATED_AT)
    tampered = copy.deepcopy(manifest)
    tampered["images"]["api"]["digest"] = f"sha256:{'f' * 64}"

    with pytest.raises(candidate_manifest.ManifestError, match="digest mismatch"):
        candidate_manifest.verify_manifest(ROOT, tampered, COMMIT, REPOSITORY)


def test_parse_images_rejects_mutable_tag_and_incomplete_set() -> None:
    with pytest.raises(candidate_manifest.ManifestError):
        candidate_manifest.parse_images(["api=ghcr.io/greatliverheat605/logion-api:latest"])
