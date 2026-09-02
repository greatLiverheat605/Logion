import asyncio
import hashlib
from pathlib import Path

import pytest
from logion_api.content.attachment_scanner import (
    AttachmentScannerError,
    ClamdInstreamScanner,
    DisabledAttachmentScanner,
)


@pytest.mark.asyncio
async def test_clamd_instream_streams_bytes_and_returns_digest(tmp_path: Path) -> None:
    payload = b"scanner-payload"
    path = tmp_path / "payload.bin"
    path.write_bytes(payload)

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            assert await reader.readexactly(10) == b"zINSTREAM\0"
            received = bytearray()
            while True:
                size = int.from_bytes(await reader.readexactly(4), "big")
                if size == 0:
                    break
                received.extend(await reader.readexactly(size))
            assert bytes(received) == payload
            writer.write(b"stream: OK\0")
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        result = await ClamdInstreamScanner("127.0.0.1", port, 2, 1024).scan(
            path, maximum_bytes=len(payload)
        )
    finally:
        server.close()
        await server.wait_closed()
    assert result.size_bytes == len(payload)
    assert result.sha256 == hashlib.sha256(payload).hexdigest()


@pytest.mark.asyncio
async def test_clamd_instream_malware_is_blocked(tmp_path: Path) -> None:
    path = tmp_path / "payload.bin"
    path.write_bytes(b"malware-payload")

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            assert await reader.readexactly(10) == b"zINSTREAM\0"
            while True:
                size = int.from_bytes(await reader.readexactly(4), "big")
                if size == 0:
                    break
                await reader.readexactly(size)
        finally:
            writer.write(b"stream: Eicar-Test-Signature FOUND\0")
            await writer.drain()
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        with pytest.raises(AttachmentScannerError, match="ATTACHMENT_MALWARE_FOUND"):
            await ClamdInstreamScanner("127.0.0.1", port, 2, 1024).scan(path, maximum_bytes=1024)
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_clamd_instream_timeout_and_unavailable_fail_closed(tmp_path: Path) -> None:
    path = tmp_path / "payload.bin"
    path.write_bytes(b"payload")

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            assert await reader.readexactly(10) == b"zINSTREAM\0"
            while True:
                size = int.from_bytes(await reader.readexactly(4), "big")
                if size == 0:
                    break
                await reader.readexactly(size)
            await asyncio.sleep(0.2)
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        with pytest.raises(AttachmentScannerError, match="ATTACHMENT_SCANNER_TIMEOUT"):
            await ClamdInstreamScanner("127.0.0.1", port, 0.05, 1024).scan(path, maximum_bytes=1024)
    finally:
        server.close()
        await server.wait_closed()

    with pytest.raises(AttachmentScannerError) as raised:
        await ClamdInstreamScanner("127.0.0.1", 1, 0.2, 1024).scan(path, maximum_bytes=1024)
    assert raised.value.code in {"ATTACHMENT_SCANNER_UNAVAILABLE", "ATTACHMENT_SCANNER_TIMEOUT"}


def test_scanner_requires_loopback_and_disabled_is_fail_closed(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="loopback"):
        ClamdInstreamScanner("10.0.0.1", 3310, 1, 1024)
    with pytest.raises(ValueError, match="literal IP"):
        ClamdInstreamScanner("localhost", 3310, 1, 1024)

    with pytest.raises(AttachmentScannerError, match="ATTACHMENT_SCANNER_UNAVAILABLE"):
        asyncio.run(DisabledAttachmentScanner().scan(tmp_path / "missing", maximum_bytes=1024))
