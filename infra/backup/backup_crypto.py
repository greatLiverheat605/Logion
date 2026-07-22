#!/usr/bin/env python3
"""Streaming AES-256-GCM envelope for Logion backup bundles."""

from __future__ import annotations

import argparse
import base64
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC = b"LOGIONB1"
NONCE_BYTES = 12
TAG_BYTES = 16
CHUNK_BYTES = 1024 * 1024


def load_key(path: Path) -> bytes:
    encoded = path.read_text(encoding="ascii").strip()
    try:
        key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    except (ValueError, base64.binascii.Error) as exc:
        raise SystemExit("backup key must be base64url") from exc
    if len(key) != 32:
        raise SystemExit("backup key must decode to exactly 32 bytes")
    return key


def encrypt(source: Path, target: Path, key: bytes) -> None:
    nonce = secrets.token_bytes(NONCE_BYTES)
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    with source.open("rb") as reader, target.open("xb") as writer:
        writer.write(MAGIC + nonce + (b"\0" * TAG_BYTES))
        while chunk := reader.read(CHUNK_BYTES):
            writer.write(encryptor.update(chunk))
        writer.write(encryptor.finalize())
        writer.seek(len(MAGIC) + NONCE_BYTES)
        writer.write(encryptor.tag)
        writer.flush()
        os.fsync(writer.fileno())


def decrypt(source: Path, target: Path, key: bytes) -> None:
    with source.open("rb") as reader:
        header = reader.read(len(MAGIC) + NONCE_BYTES + TAG_BYTES)
        if len(header) != len(MAGIC) + NONCE_BYTES + TAG_BYTES or not header.startswith(MAGIC):
            raise SystemExit("invalid backup envelope")
        nonce = header[len(MAGIC) : len(MAGIC) + NONCE_BYTES]
        tag = header[-TAG_BYTES:]
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        with target.open("xb") as writer:
            try:
                while chunk := reader.read(CHUNK_BYTES):
                    writer.write(decryptor.update(chunk))
                writer.write(decryptor.finalize())
            except Exception:
                writer.close()
                target.unlink(missing_ok=True)
                raise
            writer.flush()
            os.fsync(writer.fileno())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("encrypt", "decrypt"))
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    key = load_key(args.key_file)
    if args.action == "encrypt":
        encrypt(args.source, args.target, key)
    else:
        decrypt(args.source, args.target, key)


if __name__ == "__main__":
    main()
