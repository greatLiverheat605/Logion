#!/usr/bin/env python3
"""Create and safely extract versioned Logion backup bundles."""

from __future__ import annotations

import argparse
import io
import json
import tarfile
from pathlib import Path, PurePosixPath

SCHEMA_VERSION = "logion-backup-v1"
MAX_MEMBERS = 1_000_000


def create(args: argparse.Namespace) -> None:
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "created_at": args.created_at,
        "application_version": args.application_version,
        "migration_head": args.migration_head,
        "backup_key_id": args.backup_key_id,
        "contents": ["database.dump", "attachments/"],
        "restore_requires_sync_epoch_bump": True,
    }
    encoded = json.dumps(manifest, sort_keys=True, indent=2).encode()
    with tarfile.open(args.output, "x:gz") as archive:
        info = tarfile.TarInfo("manifest.json")
        info.size = len(encoded)
        info.mode = 0o400
        archive.addfile(info, io.BytesIO(encoded))
        archive.add(args.database, arcname="database.dump", recursive=False)
        attachments = args.attachments
        if attachments.exists():
            for path in sorted(attachments.rglob("*")):
                if path.is_symlink() or (not path.is_file() and not path.is_dir()):
                    raise SystemExit("attachments may contain only regular files and directories")
                relative = path.relative_to(attachments).as_posix()
                if PurePosixPath(relative).parts[0] == "staging":
                    continue
                archive.add(path, arcname=f"attachments/{relative}", recursive=False)
        else:
            empty = tarfile.TarInfo("attachments")
            empty.type = tarfile.DIRTYPE
            empty.mode = 0o500
            archive.addfile(empty)


def validate_member(member: tarfile.TarInfo) -> None:
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts or "" in path.parts:
        raise SystemExit("unsafe backup member path")
    allowed = member.name in {"manifest.json", "database.dump", "attachments"} or (
        len(path.parts) > 1 and path.parts[0] == "attachments"
    )
    if not allowed or member.issym() or member.islnk() or member.isdev():
        raise SystemExit("unsupported backup member")
    if not member.isfile() and not member.isdir():
        raise SystemExit("backup members must be files or directories")


def extract(args: argparse.Namespace) -> None:
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    with tarfile.open(args.source, "r:gz") as archive:
        members = archive.getmembers()
        if len(members) > MAX_MEMBERS:
            raise SystemExit("backup contains too many members")
        for member in members:
            validate_member(member)
        names = {member.name for member in members}
        if not {"manifest.json", "database.dump"}.issubset(names):
            raise SystemExit("backup manifest or database dump is missing")
        archive.extractall(args.output, members=members, filter="data")
    manifest = json.loads((args.output / "manifest.json").read_text(encoding="utf-8"))
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != SCHEMA_VERSION
        or manifest.get("restore_requires_sync_epoch_bump") is not True
    ):
        raise SystemExit("unsupported backup manifest")
    print(json.dumps(manifest, sort_keys=True))


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)
    create_parser = subparsers.add_parser("create")
    create_parser.add_argument("--database", type=Path, required=True)
    create_parser.add_argument("--attachments", type=Path, required=True)
    create_parser.add_argument("--output", type=Path, required=True)
    create_parser.add_argument("--created-at", required=True)
    create_parser.add_argument("--application-version", required=True)
    create_parser.add_argument("--migration-head", required=True)
    create_parser.add_argument("--backup-key-id", required=True)
    extract_parser = subparsers.add_parser("extract")
    extract_parser.add_argument("--source", type=Path, required=True)
    extract_parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "create":
        create(args)
    else:
        extract(args)


if __name__ == "__main__":
    main()
