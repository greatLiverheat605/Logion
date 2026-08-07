from __future__ import annotations

import hashlib
import ipaddress
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import anyio


@dataclass(frozen=True)
class AttachmentScanResult:
    size_bytes: int
    sha256: str


class AttachmentScannerError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class AttachmentScanner(Protocol):
    async def scan(self, path: Path, *, maximum_bytes: int) -> AttachmentScanResult: ...


class DisabledAttachmentScanner:
    async def scan(self, path: Path, *, maximum_bytes: int) -> AttachmentScanResult:
        del path, maximum_bytes
        raise AttachmentScannerError("ATTACHMENT_SCANNER_UNAVAILABLE")


class ClamdInstreamScanner:
    """Fail-closed, loopback-only ClamAV INSTREAM client."""

    def __init__(
        self,
        host: str,
        port: int,
        timeout_seconds: float,
        chunk_bytes: int,
    ) -> None:
        try:
            address = ipaddress.ip_address(host)
        except ValueError as exc:
            raise ValueError("Attachment scanner host must be a literal IP address") from exc
        if not address.is_loopback:
            raise ValueError("Attachment scanner must bind to loopback")
        if not 1 <= port <= 65535:
            raise ValueError("Attachment scanner port is invalid")
        if timeout_seconds <= 0:
            raise ValueError("Attachment scanner timeout must be positive")
        if not 1024 <= chunk_bytes <= 1024 * 1024:
            raise ValueError("Attachment scanner chunk size is invalid")
        self._host = host
        self._port = port
        self._timeout_seconds = timeout_seconds
        self._chunk_bytes = chunk_bytes

    async def scan(self, path: Path, *, maximum_bytes: int) -> AttachmentScanResult:
        digest = hashlib.sha256()
        size = 0
        try:
            async with await anyio.open_file(path, "rb") as source:
                with anyio.fail_after(self._timeout_seconds):
                    async with await anyio.connect_tcp(self._host, self._port) as stream:
                        await stream.send(b"zINSTREAM\0")
                        while chunk := await source.read(self._chunk_bytes):
                            size += len(chunk)
                            if size > maximum_bytes:
                                raise AttachmentScannerError("ATTACHMENT_SCANNER_SIZE_LIMIT")
                            digest.update(chunk)
                            await stream.send(struct.pack("!I", len(chunk)))
                            await stream.send(chunk)
                        await stream.send(b"\0\0\0\0")
                        response = await self._receive_response(stream)
        except AttachmentScannerError:
            raise
        except TimeoutError as exc:
            raise AttachmentScannerError("ATTACHMENT_SCANNER_TIMEOUT") from exc
        except (
            OSError,
            anyio.BrokenResourceError,
            anyio.ClosedResourceError,
            anyio.EndOfStream,
            anyio.IncompleteRead,
        ) as exc:
            raise AttachmentScannerError("ATTACHMENT_SCANNER_UNAVAILABLE") from exc

        if response.endswith("FOUND"):
            raise AttachmentScannerError("ATTACHMENT_MALWARE_FOUND")
        if response.endswith("OK"):
            return AttachmentScanResult(size_bytes=size, sha256=digest.hexdigest())
        raise AttachmentScannerError("ATTACHMENT_SCANNER_UNAVAILABLE")

    @staticmethod
    async def _receive_response(stream: anyio.abc.ByteStream) -> str:
        response = bytearray()
        while b"\0" not in response and len(response) <= 4096:
            try:
                response.extend(await stream.receive(4096))
            except anyio.EndOfStream as exc:
                raise AttachmentScannerError("ATTACHMENT_SCANNER_UNAVAILABLE") from exc
        if len(response) > 4096 or b"\0" not in response:
            raise AttachmentScannerError("ATTACHMENT_SCANNER_UNAVAILABLE")
        return bytes(response).split(b"\0", 1)[0].decode("ascii", "replace").strip()
