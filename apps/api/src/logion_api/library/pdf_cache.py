"""Encrypted disposable cache. The database lock also bounds PDF working memory."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from logion_api.config import Settings
from logion_api.content.models import Resource
from logion_api.db import utc_now
from logion_api.integrations.keyring import Envelope, decrypt, encrypt
from logion_api.integrations.models import IntegrationCredential
from logion_api.integrations.network import integration_error
from logion_api.library.pdf_models import PdfCacheBinding, PdfCacheEntry


async def lock_cache(db: AsyncSession) -> None:
    # ponytail: one PDF operation across processes; use streaming AEAD chunks if throughput grows.
    if not await db.scalar(text("SELECT pg_try_advisory_xact_lock(74003248)")):
        raise integration_error("PDF_BUSY", 429)


def cache_root(settings: Settings) -> Path:
    root = Path(settings.attachment_root) / "research-pdf"
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink():
        raise integration_error("PDF_CACHE_UNAVAILABLE", 503)
    return root


def cache_path(settings: Settings, key: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", key):
        raise integration_error("PDF_CACHE_UNAVAILABLE", 503)
    return cache_root(settings) / (key + ".bin")


def locator_digest(resource: Resource) -> str:
    return hashlib.sha256(
        json.dumps(
            [resource.file_locator, resource.zotero_attachment_version],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


async def evict(db: AsyncSession, settings: Settings, entry: PdfCacheEntry) -> None:
    await asyncio.to_thread(cache_path(settings, entry.storage_key).unlink, missing_ok=True)
    await db.execute(delete(PdfCacheBinding).where(PdfCacheBinding.sha256 == entry.sha256))
    await db.execute(delete(PdfCacheEntry).where(PdfCacheEntry.sha256 == entry.sha256))


async def cleanup(db: AsyncSession, settings: Settings, *, reserve: int = 0) -> None:
    entries = list(await db.scalars(select(PdfCacheEntry).order_by(PdfCacheEntry.last_used_at)))
    live = {row.storage_key + ".bin" for row in entries}
    # Recover only this cache's orphan ciphertext after a rolled-back transaction or crash.
    for file in await asyncio.to_thread(lambda: list(cache_root(settings).iterdir())):
        if re.fullmatch(r"[a-f0-9]{32}\.bin", file.name) and file.name not in live:
            await asyncio.to_thread(file.unlink)
    bound = set(await db.scalars(select(PdfCacheBinding.sha256)))
    retained = []
    for row in entries:
        if row.sha256 not in bound:
            await evict(db, settings, row)
        else:
            retained.append(row)
    entries = retained
    total = sum(row.encrypted_bytes for row in entries)
    for entry in entries:
        if total + reserve <= settings.pdf_cache_max_bytes:
            break
        total -= entry.encrypted_bytes
        await evict(db, settings, entry)


async def load_cached(
    db: AsyncSession,
    settings: Settings,
    resource: Resource,
    credential: IntegrationCredential,
) -> bytes | None:
    binding = await db.get(PdfCacheBinding, resource.id)
    if binding is None or (
        binding.credential_id != credential.id
        or binding.credential_revision != credential.nonce
        or binding.locator_digest != locator_digest(resource)
    ):
        return None
    entry = await db.get(PdfCacheEntry, binding.sha256)
    if entry is None or entry.size_bytes > settings.pdf_max_bytes:
        return None
    file = cache_path(settings, entry.storage_key)
    if not file.is_file() or file.is_symlink():
        return None
    if file.stat().st_size != entry.encrypted_bytes:
        raise integration_error("PDF_CACHE_INVALID", 503)
    ciphertext = await asyncio.to_thread(file.read_bytes)
    data = decrypt(
        settings.pdf_cache_keyring,
        Envelope(
            ciphertext,
            entry.nonce,
            entry.wrapped_key,
            entry.key_nonce,
            entry.key_id,
        ),
        aad=f"logion:pdf:v1:{entry.sha256}".encode(),
    )
    if len(data) != entry.size_bytes or hashlib.sha256(data).hexdigest() != entry.sha256:
        raise integration_error("PDF_CACHE_INVALID", 503)
    return data


async def store_cached(
    db: AsyncSession,
    settings: Settings,
    resource: Resource,
    credential: IntegrationCredential,
    data: bytes,
) -> str:
    digest = hashlib.sha256(data).hexdigest()
    entry = await db.get(PdfCacheEntry, digest)
    if entry is not None:
        file = cache_path(settings, entry.storage_key)
        if not file.is_file() or file.is_symlink() or file.stat().st_size != entry.encrypted_bytes:
            await evict(db, settings, entry)
            entry = None
    if entry is None:
        if len(data) + 16 > settings.pdf_cache_max_bytes:
            raise integration_error("PDF_CACHE_TOO_SMALL", 503)
        await cleanup(db, settings, reserve=len(data) + 16)
        envelope = encrypt(settings.pdf_cache_keyring, data, aad=f"logion:pdf:v1:{digest}".encode())
        key = uuid4().hex

        def write() -> None:
            with cache_path(settings, key).open("xb") as file:
                file.write(envelope.ciphertext)

        await asyncio.to_thread(write)
        entry = PdfCacheEntry(
            sha256=digest,
            storage_key=key,
            size_bytes=len(data),
            encrypted_bytes=len(envelope.ciphertext),
            nonce=envelope.nonce,
            wrapped_key=envelope.wrapped_key,
            key_nonce=envelope.key_nonce,
            key_id=envelope.key_id,
        )
        db.add(entry)
        await db.flush()
    entry.last_used_at = utc_now()
    binding = await db.get(PdfCacheBinding, resource.id)
    if binding is None:
        binding = PdfCacheBinding(resource_id=resource.id)
        db.add(binding)
    binding.sha256, binding.credential_id = digest, credential.id
    binding.credential_revision = credential.nonce
    binding.locator_digest = locator_digest(resource)
    return digest


async def remove_resource_cache(db: AsyncSession, settings: Settings, resource: Resource) -> None:
    binding = await db.get(PdfCacheBinding, resource.id)
    if binding and (entry := await db.get(PdfCacheEntry, binding.sha256)):
        # Other owners re-fetch their authorized copy after a shared entry is evicted.
        await evict(db, settings, entry)
