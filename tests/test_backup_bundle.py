import argparse
import base64
import importlib.util
import io
import tarfile
from pathlib import Path
from types import ModuleType

import pytest
from cryptography.exceptions import InvalidTag


def load(name: str) -> ModuleType:
    path = Path(__file__).parents[1] / "infra" / "backup" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_streaming_backup_envelope_authenticates_ciphertext(tmp_path: Path) -> None:
    crypto = load("backup_crypto")
    key_file = tmp_path / "key"
    key_file.write_text(base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("="))
    source = tmp_path / "source.tar.gz"
    source.write_bytes((b"private-backup-block" * 200_000) + b"tail")
    encrypted = tmp_path / "backup"
    restored = tmp_path / "restored"
    key = crypto.load_key(key_file)

    crypto.encrypt(source, encrypted, key)
    assert b"private-backup-block" not in encrypted.read_bytes()
    crypto.decrypt(encrypted, restored, key)
    assert restored.read_bytes() == source.read_bytes()

    tampered = bytearray(encrypted.read_bytes())
    tampered[-1] ^= 1
    encrypted.write_bytes(tampered)
    failed = tmp_path / "failed"
    with pytest.raises(InvalidTag):
        crypto.decrypt(encrypted, failed, key)
    assert not failed.exists()


def test_bundle_round_trip_and_path_traversal_rejection(tmp_path: Path) -> None:
    bundle = load("backup_bundle")
    database = tmp_path / "database.dump"
    database.write_bytes(b"postgres-custom-dump")
    attachments = tmp_path / "attachments"
    attachments.mkdir()
    (attachments / "evidence.txt").write_text("verified attachment")
    archive = tmp_path / "bundle.tar.gz"
    bundle.create(
        argparse.Namespace(
            database=database,
            attachments=attachments,
            output=archive,
            created_at="2026-07-23T00:00:00Z",
            application_version="test",
            migration_head="0031_account_deletion",
            backup_key_id="test-v1",
        )
    )
    extracted = tmp_path / "extracted"
    bundle.extract(argparse.Namespace(source=archive, output=extracted))
    assert (extracted / "database.dump").read_bytes() == database.read_bytes()
    assert (extracted / "attachments" / "evidence.txt").read_text() == "verified attachment"

    malicious = tmp_path / "malicious.tar.gz"
    with tarfile.open(malicious, "w:gz") as value:
        member = tarfile.TarInfo("../escape")
        member.size = 1
        value.addfile(member, io.BytesIO(b"x"))
    with pytest.raises(SystemExit, match="unsafe backup member path"):
        bundle.extract(argparse.Namespace(source=malicious, output=tmp_path / "malicious-output"))
    assert not (tmp_path / "escape").exists()
