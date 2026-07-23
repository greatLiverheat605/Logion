import hashlib
import json
import os
import re
import shutil
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
    def __init__(self, root: str) -> None:
        self._root = Path(root).expanduser().resolve()
        self._staging = self._root / "staging"
        self._verified = self._root / "verified"
        self._staging.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._verified.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._staging.chmod(0o700)
        self._verified.chmod(0o700)

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

    async def finalize(self, staging_key: str, storage_key: str) -> None:
        source = self._staging_path(staging_key)
        destination = self._verified_path(storage_key)
        temporary = destination.with_name(f".{destination.name}.{os.urandom(16).hex()}.tmp")
        await anyio.to_thread.run_sync(destination.parent.mkdir, 0o700, True, True)
        try:
            await anyio.to_thread.run_sync(shutil.copyfile, source, temporary)
            await anyio.to_thread.run_sync(temporary.chmod, 0o600)
            await anyio.to_thread.run_sync(os.replace, temporary, destination)
        except FileNotFoundError as exc:
            raise AttachmentStorageError("ATTACHMENT_UPLOAD_MISSING") from exc
        finally:
            if temporary.exists():
                await anyio.to_thread.run_sync(temporary.unlink)

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
