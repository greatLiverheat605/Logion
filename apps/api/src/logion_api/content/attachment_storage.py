import hashlib
import json
import os
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

import anyio

KEY = re.compile(r"^[0-9a-f]{32,64}$")


class AttachmentStorageError(Exception):
    pass


@dataclass(frozen=True)
class AttachmentInspection:
    size_bytes: int
    sha256: str
    detected_mime: str


def detect_mime(declared_mime: str, content: bytes) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if declared_mime in {"application/json", "text/plain", "text/csv"}:
        if b"\x00" in content:
            raise AttachmentStorageError("ATTACHMENT_MIME_MISMATCH")
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AttachmentStorageError("ATTACHMENT_MIME_MISMATCH") from exc
        if declared_mime == "application/json":
            try:
                json.loads(text)
            except json.JSONDecodeError as exc:
                raise AttachmentStorageError("ATTACHMENT_MIME_MISMATCH") from exc
        return declared_mime
    raise AttachmentStorageError("ATTACHMENT_MIME_MISMATCH")


class FilesystemAttachmentStorage:
    def __init__(self, root: str, quarantine_root: str | None = None) -> None:
        self._root = Path(root).expanduser().resolve()
        self._staging = self._root / "staging"
        self._verified = self._root / "verified"
        self._quarantine = (
            Path(quarantine_root).expanduser().resolve()
            if quarantine_root is not None
            else self._root / "quarantine"
        )
        self._staging.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._verified.mkdir(mode=0o750, parents=True, exist_ok=True)
        self._quarantine.mkdir(mode=0o750, parents=True, exist_ok=True)
        self._staging.chmod(0o700)
        self._verified.chmod(0o750)
        self._quarantine.chmod(0o750)

    def _staging_path(self, key: str) -> Path:
        if KEY.fullmatch(key) is None:
            raise AttachmentStorageError("ATTACHMENT_STORAGE_KEY_INVALID")
        return self._staging / f"{key}.part"

    def _verified_path(self, storage_key: str) -> Path:
        parts = storage_key.split("/")
        if len(parts) != 2 or any(KEY.fullmatch(part.replace("-", "")) is None for part in parts):
            raise AttachmentStorageError("ATTACHMENT_STORAGE_KEY_INVALID")
        path = (self._verified / parts[0] / parts[1]).resolve()
        if not path.is_relative_to(self._verified):
            raise AttachmentStorageError("ATTACHMENT_STORAGE_KEY_INVALID")
        return path

    async def write_staging(
        self,
        staging_key: str,
        stream: AsyncIterator[bytes],
        *,
        maximum_bytes: int,
    ) -> int:
        destination = self._staging_path(staging_key)
        temporary = self._staging_path(f"{staging_key}{os.urandom(16).hex()}")
        total = 0
        try:
            async with await anyio.open_file(temporary, "wb") as handle:
                async for chunk in stream:
                    total += len(chunk)
                    if total > maximum_bytes:
                        raise AttachmentStorageError("ATTACHMENT_SIZE_MISMATCH")
                    await handle.write(chunk)
                await handle.flush()
            await anyio.to_thread.run_sync(temporary.chmod, 0o600)
            await anyio.to_thread.run_sync(os.replace, temporary, destination)
            return total
        finally:
            if temporary.exists():
                await anyio.to_thread.run_sync(temporary.unlink)

    async def inspect(
        self, staging_key: str, *, declared_mime: str, maximum_bytes: int
    ) -> AttachmentInspection:
        path = self._staging_path(staging_key)
        digest = hashlib.sha256()
        size = 0
        content = bytearray()
        try:
            async with await anyio.open_file(path, "rb") as handle:
                while chunk := await handle.read(1024 * 1024):
                    size += len(chunk)
                    if size > maximum_bytes:
                        raise AttachmentStorageError("ATTACHMENT_SIZE_MISMATCH")
                    digest.update(chunk)
                    if declared_mime in {"application/json", "text/plain", "text/csv"}:
                        content.extend(chunk)
                    elif len(content) < 16:
                        content.extend(chunk[: 16 - len(content)])
        except FileNotFoundError as exc:
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING") from exc
        detected = detect_mime(declared_mime, bytes(content))
        return AttachmentInspection(size, digest.hexdigest(), detected)

    async def finalize(self, staging_key: str, storage_key: str, expected_sha256: str) -> None:
        source = self._staging_path(staging_key)
        destination = self._verified_path(storage_key)
        temporary = destination.with_name(f".{destination.name}.{os.urandom(16).hex()}.tmp")
        await anyio.to_thread.run_sync(destination.parent.mkdir, 0o750, True, True)
        try:
            await anyio.to_thread.run_sync(
                self._copy_and_verify,
                source,
                temporary,
                expected_sha256,
            )
            await anyio.to_thread.run_sync(temporary.chmod, 0o640)
            await anyio.to_thread.run_sync(os.replace, temporary, destination)
        except FileNotFoundError as exc:
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING") from exc
        finally:
            if temporary.exists():
                await anyio.to_thread.run_sync(temporary.unlink)

    @staticmethod
    def _copy_and_verify(source: Path, temporary: Path, expected_sha256: str) -> None:
        if source.is_symlink() or not source.is_file():
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING")
        digest = hashlib.sha256()
        with source.open("rb") as source_handle, temporary.open("xb") as target_handle:
            while chunk := source_handle.read(1024 * 1024):
                digest.update(chunk)
                target_handle.write(chunk)
            target_handle.flush()
            os.fsync(target_handle.fileno())
        if digest.hexdigest() != expected_sha256:
            temporary.unlink(missing_ok=True)
            raise AttachmentStorageError("ATTACHMENT_HASH_MISMATCH")

    def staging_path(self, staging_key: str) -> Path:
        path = self._staging_path(staging_key)
        if path.is_symlink() or not path.is_file():
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING")
        return path

    def _quarantine_path(self, quarantine_key: str) -> Path:
        if KEY.fullmatch(quarantine_key) is None:
            raise AttachmentStorageError("ATTACHMENT_QUARANTINE_FAILED")
        path = (self._quarantine / quarantine_key[:2] / quarantine_key).resolve()
        if not path.is_relative_to(self._quarantine):
            raise AttachmentStorageError("ATTACHMENT_QUARANTINE_FAILED")
        return path

    async def quarantine(self, staging_key: str, quarantine_key: str) -> None:
        source = self._staging_path(staging_key)
        destination = self._quarantine_path(quarantine_key)
        if source.is_symlink() or not source.is_file():
            raise AttachmentStorageError("ATTACHMENT_QUARANTINE_FAILED")
        try:
            await anyio.to_thread.run_sync(destination.parent.mkdir, 0o750, True, True)
            await anyio.to_thread.run_sync(os.replace, source, destination)
            await anyio.to_thread.run_sync(destination.chmod, 0o640)
        except (FileExistsError, FileNotFoundError, OSError) as exc:
            raise AttachmentStorageError("ATTACHMENT_QUARANTINE_FAILED") from exc

    async def discard_staging(self, staging_key: str) -> None:
        path = self._staging_path(staging_key)
        if path.exists():
            await anyio.to_thread.run_sync(path.unlink)

    def verified_path(self, storage_key: str) -> Path:
        path = self._verified_path(storage_key)
        if not path.is_file():
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING")
        return path

    async def delete(self, *, staging_key: str, storage_key: str | None) -> None:
        paths = [self._staging_path(staging_key)]
        if storage_key is not None:
            paths.append(self._verified_path(storage_key))
        for path in paths:
            if path.exists():
                await anyio.to_thread.run_sync(path.unlink)
