import hashlib
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import pytest
from logion_api.content.attachment_schemas import AttachmentInit
from logion_api.content.attachment_storage import (
    AttachmentStorageError,
    FilesystemAttachmentStorage,
    detect_mime,
)
from pydantic import ValidationError


async def chunks(*values: bytes) -> AsyncIterator[bytes]:
    for value in values:
        yield value


@pytest.mark.parametrize(
    ("declared", "content", "detected"),
    [
        ("image/png", b"\x89PNG\r\n\x1a\nrest", "image/png"),
        ("image/jpeg", b"\xff\xd8\xffrest", "image/jpeg"),
        ("image/webp", b"RIFF0000WEBPrest", "image/webp"),
        ("application/pdf", b"%PDF-1.7\n", "application/pdf"),
        ("application/json", b'{"safe":true}', "application/json"),
        ("text/plain", "离线结果".encode(), "text/plain"),
        ("text/csv", b"metric,value\nloss,0.1\n", "text/csv"),
    ],
)
def test_detect_mime_allowlist(declared: str, content: bytes, detected: str) -> None:
    assert detect_mime(declared, content) == detected


@pytest.mark.parametrize(
    "payload",
    [
        {"filename": "../result.png", "declared_mime": "image/png"},
        {"filename": "result.jpg", "declared_mime": "image/png"},
        {"filename": "result.exe", "declared_mime": "application/pdf"},
    ],
)
def test_init_rejects_paths_and_extension_mismatch(payload: dict[str, str]) -> None:
    with pytest.raises(ValidationError):
        AttachmentInit.model_validate(
            {
                "id": uuid4(),
                "target_type": "note",
                "target_id": uuid4(),
                "size_bytes": 8,
                "sha256": "0" * 64,
                **payload,
            }
        )


@pytest.mark.asyncio
async def test_storage_stages_inspects_finalizes_and_rejects_oversize(tmp_path: Path) -> None:
    storage = FilesystemAttachmentStorage(str(tmp_path))
    content = b"%PDF-1.7\nsmall"
    staging_key = "a" * 32

    assert await storage.write_staging(
        staging_key, chunks(content[:5], content[5:]), maximum_bytes=len(content)
    ) == len(content)
    inspection = await storage.inspect(
        staging_key, declared_mime="application/pdf", maximum_bytes=len(content)
    )
    assert inspection.sha256 == hashlib.sha256(content).hexdigest()
    assert inspection.detected_mime == "application/pdf"

    storage_key = f"{uuid4()}/{uuid4()}"
    await storage.finalize(staging_key, storage_key)
    assert storage.verified_path(storage_key).read_bytes() == content
    await storage.delete(staging_key=staging_key, storage_key=storage_key)
    with pytest.raises(AttachmentStorageError, match="ATTACHMENT_UPLOAD_MISSING"):
        storage.verified_path(storage_key)

    with pytest.raises(AttachmentStorageError, match="ATTACHMENT_SIZE_MISMATCH"):
        await storage.write_staging("b" * 32, chunks(b"too large"), maximum_bytes=2)


def test_text_mime_rejects_binary_and_json_requires_valid_document() -> None:
    with pytest.raises(AttachmentStorageError, match="ATTACHMENT_MIME_MISMATCH"):
        detect_mime("text/plain", b"bad\x00content")
    with pytest.raises(AttachmentStorageError, match="ATTACHMENT_MIME_MISMATCH"):
        detect_mime("application/json", b"not-json")
