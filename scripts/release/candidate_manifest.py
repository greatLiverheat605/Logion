"""Generate and verify the immutable Logion release candidate manifest."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SERVICES = ("api", "backup", "web", "worker")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_RE = re.compile(
    r"^ghcr\.io/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?/[a-z0-9][a-z0-9._/-]*@"
    r"sha256:[0-9a-f]{64}$"
)
OFFLINE_VERSION_RE = re.compile(r"OFFLINE_SCHEMA_VERSION\s*=\s*(\d+)\s+as\s+const")


class ManifestError(ValueError):
    """The candidate manifest or its source metadata is invalid."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def _literal_assignment(path: Path, name: str) -> Any:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == name
            and node.value is not None
        ):
            return ast.literal_eval(node.value)
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == name:
                    return ast.literal_eval(node.value)
    raise ManifestError(f"{path}: missing {name}")


def migration_head(root: Path) -> str:
    revisions: set[str] = set()
    referenced: set[str] = set()
    migration_dir = root / "apps/api/migrations/versions"
    for path in sorted(migration_dir.glob("*.py")):
        revision = _literal_assignment(path, "revision")
        down_revision = _literal_assignment(path, "down_revision")
        if not isinstance(revision, str) or not revision:
            raise ManifestError(f"{path}: revision must be a non-empty string")
        if revision in revisions:
            raise ManifestError(f"duplicate migration revision: {revision}")
        revisions.add(revision)
        if isinstance(down_revision, str):
            referenced.add(down_revision)
        elif isinstance(down_revision, (tuple, list)):
            if not all(isinstance(item, str) for item in down_revision):
                raise ManifestError(f"{path}: invalid down_revision")
            referenced.update(down_revision)
        elif down_revision is not None:
            raise ManifestError(f"{path}: invalid down_revision")
    heads = revisions - referenced
    if len(heads) != 1:
        raise ManifestError(f"expected one migration head, found {sorted(heads)}")
    return heads.pop()


def compatibility(root: Path) -> dict[str, str | int]:
    sync_schema = json.loads(
        (root / "packages/contracts/schemas/sync-v1.schema.json").read_text(encoding="utf-8")
    )
    try:
        protocol = sync_schema["$defs"]["protocolVersion"]["const"]
    except (KeyError, TypeError) as exc:
        raise ManifestError("sync schema does not declare a constant protocol version") from exc
    offline_source = (root / "packages/offline/src/types.ts").read_text(encoding="utf-8")
    match = OFFLINE_VERSION_RE.search(offline_source)
    if not isinstance(protocol, str) or not protocol or match is None:
        raise ManifestError("invalid sync protocol or offline schema version")
    return {
        "migration_head": migration_head(root),
        "sync_protocol": protocol,
        "offline_schema": int(match.group(1)),
    }


def application_version(root: Path) -> str:
    with (root / "pyproject.toml").open("rb") as source:
        value = tomllib.load(source).get("project", {}).get("version")
    if not isinstance(value, str) or not value:
        raise ManifestError("pyproject.toml does not declare project.version")
    return value


def parse_images(values: list[str]) -> dict[str, dict[str, str]]:
    images: dict[str, dict[str, str]] = {}
    for value in values:
        service, separator, image = value.partition("=")
        if (
            not separator
            or service not in SERVICES
            or service in images
            or not IMAGE_RE.fullmatch(image)
        ):
            raise ManifestError(f"invalid image assignment: {value}")
        _, digest = image.rsplit("@", 1)
        images[service] = {"reference": image, "digest": digest}
    if set(images) != set(SERVICES):
        raise ManifestError(f"images must contain exactly: {', '.join(SERVICES)}")
    return dict(sorted(images.items()))


def artifact_hashes(root: Path) -> dict[str, str]:
    paths = {
        "openapi": root / "packages/contracts/openapi/openapi.json",
        "pnpm_lock": root / "pnpm-lock.yaml",
        "uv_lock": root / "uv.lock",
    }
    return {name: sha256_file(path) for name, path in paths.items()}


def build_manifest(
    root: Path,
    source_commit: str,
    repository: str,
    images: dict[str, dict[str, str]],
    generated_at: str,
) -> dict[str, Any]:
    if not SHA_RE.fullmatch(source_commit):
        raise ManifestError("source commit must be a lowercase 40-character Git SHA")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ManifestError("repository must use owner/name format")
    try:
        timestamp = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ManifestError("generated_at must be an ISO-8601 timestamp") from exc
    if timestamp.tzinfo is None:
        raise ManifestError("generated_at must include a timezone")
    return {
        "schema_version": SCHEMA_VERSION,
        "candidate_id": source_commit,
        "generated_at": timestamp.astimezone(UTC).isoformat().replace("+00:00", "Z"),
        "source": {"repository": repository, "commit": source_commit},
        "application_version": application_version(root),
        "images": images,
        "compatibility": compatibility(root),
        "artifacts": artifact_hashes(root),
    }


def verify_manifest(
    root: Path,
    manifest: dict[str, Any],
    expected_commit: str,
    expected_repository: str,
) -> None:
    images_value = manifest.get("images")
    if not isinstance(images_value, dict):
        raise ManifestError("images must be an object")
    image_assignments: list[str] = []
    for service, value in images_value.items():
        if not isinstance(service, str) or not isinstance(value, dict):
            raise ManifestError("invalid image entry")
        reference = value.get("reference")
        digest = value.get("digest")
        if not isinstance(reference, str) or not isinstance(digest, str):
            raise ManifestError("image reference and digest must be strings")
        if not DIGEST_RE.fullmatch(digest) or not reference.endswith(f"@{digest}"):
            raise ManifestError(f"image digest mismatch for {service}")
        image_assignments.append(f"{service}={reference}")
    normalized_images = parse_images(image_assignments)
    rebuilt = build_manifest(
        root,
        expected_commit,
        expected_repository,
        normalized_images,
        str(manifest.get("generated_at", "")),
    )
    if manifest != rebuilt:
        raise ManifestError("manifest does not match the checked-out source or expected candidate")


def _load_manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ManifestError("manifest root must be an object")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    generate = subparsers.add_parser("generate")
    generate.add_argument("--root", type=Path, default=Path.cwd())
    generate.add_argument("--source-commit", required=True)
    generate.add_argument("--repository", required=True)
    generate.add_argument("--generated-at", required=True)
    generate.add_argument("--image", action="append", required=True)
    generate.add_argument("--output", type=Path, required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--root", type=Path, default=Path.cwd())
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--expected-commit", required=True)
    verify.add_argument("--expected-repository", required=True)
    args = parser.parse_args()
    try:
        if args.command == "generate":
            manifest = build_manifest(
                args.root.resolve(),
                args.source_commit,
                args.repository,
                parse_images(args.image),
                args.generated_at,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
        else:
            verify_manifest(
                args.root.resolve(),
                _load_manifest(args.manifest),
                args.expected_commit,
                args.expected_repository,
            )
    except (ManifestError, json.JSONDecodeError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
