import base64
import hashlib
import io
import stat
import zipfile
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from logion_api.config import get_settings
from logion_api.content.models import Resource
from logion_api.db import engine, session_factory
from logion_api.errors import APIError
from logion_api.integrations.keyring import IntegrationKeyring
from logion_api.integrations.webdav import enforce_rate
from logion_api.library.pdf_cache import cache_path, lock_cache
from logion_api.library.pdf_models import PdfCacheBinding, PdfCacheEntry
from logion_api.library.pdf_validation import unzip_pdf, validate_pdf, webdav_path
from logion_api.main import app
from sqlalchemy import event, select

PDF = b"%PDF-1.7\nsynthetic paper\n%%EOF"


def zipped(
    entries: list[tuple[str | zipfile.ZipInfo, bytes]], compression: int = zipfile.ZIP_STORED
) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=compression) as archive:
        for name, data in entries:
            archive.writestr(name, data)
    return output.getvalue()


def test_zip_and_pdf_trust_boundaries() -> None:
    assert unzip_pdf(zipped([("paper.pdf", PDF)]), 1024) == PDF
    link = zipfile.ZipInfo("link.pdf")
    link.external_attr = (stat.S_IFLNK | 0o777) << 16
    hostile = [
        zipped([]),
        zipped([("a.pdf", PDF), ("b.pdf", PDF)]),
        zipped([("../paper.pdf", PDF)]),
        zipped([("/paper.pdf", PDF)]),
        zipped([("C:paper.pdf", PDF)]),
        zipped([("a\\paper.pdf", PDF)]),
        zipped([(link, PDF)]),
        zipped([("paper.pdf", b"not a PDF")]),
        zipped([("paper.pdf", b"%PDF" + b"a" * 100000)], zipfile.ZIP_DEFLATED),
        b"invalid zip",
    ]
    for data in hostile:
        with pytest.raises(APIError):
            unzip_pdf(data, 200000)
    with pytest.raises(APIError):
        unzip_pdf(zipped([("paper.pdf", PDF)]), len(PDF) - 1)
    with pytest.raises(APIError):
        validate_pdf(PDF, len(PDF) - 1)
    for path in ("../paper.pdf", "https://untrusted.example.com/file", "zotero/AAAAAAAA.zip?x=1"):
        with pytest.raises(APIError):
            webdav_path({"kind": "zotero_webdav", "path": path})


@pytest.fixture
def dav_server() -> Iterator[tuple[str, dict[str, Any]]]:
    state: dict[str, Any] = {
        "files": {"/dav/zotero/A0000001.zip": zipped([("paper.pdf", PDF)])},
        "requests": [],
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            pass

        def respond(self, status: int, body: bytes = b"") -> None:
            state["requests"].append((self.command, self.path))
            assert self.headers.get("Authorization", "").startswith("Basic ")
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            self.respond(
                200 if self.path in state["files"] else 404, state["files"].get(self.path, b"")
            )

        def do_PROPFIND(self) -> None:  # noqa: N802
            self.respond(207)

        def do_MKCOL(self) -> None:  # noqa: N802
            self.respond(201)

        def do_PUT(self) -> None:  # noqa: N802
            state["files"][self.path] = self.rfile.read(int(self.headers["Content-Length"]))
            self.respond(201)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pdf_import_cache_authorization_revocation_and_usage(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    dav_server: tuple[str, dict[str, Any]],
) -> None:
    settings = get_settings()
    origin, fake = dav_server
    for name, value in {
        "research_v3_enabled": True,
        "env": "test",
        "webdav_origin": origin,
        "attachment_root": str(tmp_path),
        "pdf_max_bytes": 1024,
    }.items():
        monkeypatch.setattr(settings, name, value)
    ring = IntegrationKeyring(
        active="test", keys={"test": base64.urlsafe_b64encode(b"p" * 32).decode()}
    )
    monkeypatch.setattr(settings, "integration_keyring", ring)
    monkeypatch.setattr(settings, "pdf_cache_keyring", ring)
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.220", 48001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.221", 48002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        bases = []
        for client in (owner, peer):
            registered = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"pdf-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert registered.status_code == 201, registered.text
            client.headers["X-CSRF-Token"] = client.cookies["logion_csrf"]
            workspace = (await client.get("/api/v1/workspaces")).json()["workspaces"][0]["id"]
            space = (await client.get(f"/api/v1/workspaces/{workspace}/spaces")).json()["spaces"][
                0
            ]["id"]
            bases.append(f"/api/v1/workspaces/{workspace}/spaces/{space}/library/resources")
            dav = "/api/v1/research/integrations/webdav"
            configured = await client.put(
                dav, json={"username": f"synthetic-{uuid4()}", "credential": "synthetic-dav"}
            )
            assert configured.status_code == 200, configured.text
            assert (await client.post(dav + "/test")).json()["connected"]
        base, peer_base = bases
        count = len(fake["requests"])
        for headers, expected in [
            ({"Content-Type": "application/pdf", "X-CSRF-Token": "invalid"}, 403),
            ({"Content-Type": "application/pdf", "Origin": "https://untrusted.example.com"}, 403),
        ]:
            assert (
                await owner.post(base + "/pdf-import", content=PDF, headers=headers)
            ).status_code == expected
        assert (
            await owner.post(
                base + "/pdf-import",
                content=PDF + b"x" * 1024,
                headers={"X-PDF-Title": "Oversize upload", "Content-Type": "application/pdf"},
            )
        ).status_code == 413
        assert len(fake["requests"]) == count
        imported = await owner.post(
            base + "/pdf-import",
            content=PDF,
            headers={"X-PDF-Title": "Synthetic import", "Content-Type": "application/pdf"},
        )
        assert imported.status_code == 201, imported.text
        resource = imported.json()
        digest = hashlib.sha256(PDF).hexdigest()
        assert fake["files"][f"/dav/Logion/{digest}.pdf"] == PDF
        assert resource["file_locator"]["kind"] == "logion_webdav"
        assert (
            await owner.post(
                base + "/pdf-import",
                content=PDF,
                headers={"X-PDF-Title": "Duplicate", "Content-Type": "application/pdf"},
            )
        ).json()["id"] == resource["id"]
        pdf_path = base + "/" + resource["id"] + "/pdf"
        before = len(fake["requests"])
        for headers in (
            {"X-CSRF-Token": "invalid"},
            {"Origin": "https://untrusted.example.com"},
        ):
            assert (await owner.post(pdf_path + "/prepare", headers=headers)).status_code == 403
        assert (await peer.post(pdf_path + "/prepare")).status_code == 404
        assert len(fake["requests"]) == before
        writes: list[str] = []

        def capture_write(
            _connection: Any,
            _cursor: Any,
            statement: str,
            _parameters: Any,
            _context: Any,
            _executemany: bool,
        ) -> None:
            if statement.lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE ")):
                writes.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", capture_write)
        try:
            delivered = await owner.get(pdf_path)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_write)
        assert delivered.status_code == 200, delivered.text
        assert writes == [], "PDF GET must not write database rows"
        assert delivered.content == PDF and len(fake["requests"]) == before
        for header, expected in {
            "content-type": "application/pdf",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox",
            "cache-control": "private, no-store",
        }.items():
            assert delivered.headers[header] == expected
        assert (await peer.get(pdf_path)).status_code == 404
        # Guessing someone else's shared hash never establishes a cache binding.
        guessed = await peer.post(
            peer_base, json={"title": "Guessed", "file_locator": resource["file_locator"]}
        )
        assert guessed.status_code == 201
        fake["files"].pop(f"/dav/Logion/{digest}.pdf")
        guessed_path = peer_base + "/" + guessed.json()["id"] + "/pdf"
        assert (await peer.get(guessed_path)).json()["code"] == "PDF_NOT_PREPARED"
        denied = await peer.post(guessed_path + "/prepare")
        assert denied.status_code == 503 and denied.json()["code"] == "PDF_REMOTE_UNAVAILABLE"
        async with session_factory() as db:
            entry = await db.get(PdfCacheEntry, digest)
            assert entry and PDF not in cache_path(settings, entry.storage_key).read_bytes()
            binding = await db.get(PdfCacheBinding, UUID(resource["id"]))
            assert binding and binding.sha256 == digest
            await lock_cache(db)
            assert (await owner.get(pdf_path)).json()["code"] == "PDF_BUSY"
            assert (await owner.post(pdf_path + "/prepare")).json()["code"] == "PDF_BUSY"
        # Zotero bytes count even when ZIP or size validation subsequently rejects them.
        zotero = await owner.post(
            base,
            json={
                "title": "Zotero file",
                "file_locator": {"kind": "zotero_webdav", "path": "zotero/A0000001.zip"},
            },
        )
        zotero_path = base + "/" + zotero.json()["id"] + "/pdf"
        before = len(fake["requests"])
        writes.clear()
        event.listen(engine.sync_engine, "before_cursor_execute", capture_write)
        try:
            unprepared = await owner.get(zotero_path)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_write)
        assert unprepared.status_code == 409 and unprepared.json()["code"] == "PDF_NOT_PREPARED"
        assert writes == [] and len(fake["requests"]) == before
        assert (await owner.post(zotero_path + "/prepare")).status_code == 204
        assert (await owner.get(zotero_path)).content == PDF
        usage = (await owner.get("/api/v1/research/pdf-usage")).json()
        assert usage["downloaded_bytes"] == len(fake["files"]["/dav/zotero/A0000001.zip"])
        fake["files"]["/dav/zotero/A0000002.zip"] = b"x" * 1025
        large = await owner.post(
            base,
            json={
                "title": "Oversized",
                "file_locator": {"kind": "zotero_webdav", "path": "zotero/A0000002.zip"},
            },
        )
        assert (
            await owner.post(base + "/" + large.json()["id"] + "/pdf/prepare")
        ).status_code == 413
        assert (await owner.get("/api/v1/research/pdf-usage")).json()["downloaded_bytes"] == usage[
            "downloaded_bytes"
        ] + 1025
        # Same attachment key with a newer upstream version must bypass the old binding.
        fake["files"]["/dav/zotero/A0000001.zip"] = zipped([("paper.pdf", PDF + b" updated")])
        async with session_factory() as db:
            changed = await db.get(Resource, UUID(zotero.json()["id"]))
            assert changed
            changed.zotero_attachment_version = 2
            await db.commit()
        assert (await owner.get(zotero_path)).json()["code"] == "PDF_NOT_PREPARED"
        assert (await owner.post(zotero_path + "/prepare")).status_code == 204
        assert (await owner.get(zotero_path)).content == PDF + b" updated"
        # Missing ciphertext never causes a GET to delete cache rows or fetch WebDAV.
        updated_digest = hashlib.sha256(PDF + b" updated").hexdigest()
        async with session_factory() as db:
            missing = await db.get(PdfCacheEntry, updated_digest)
            assert missing
            cache_path(settings, missing.storage_key).unlink()
        before = len(fake["requests"])
        writes.clear()
        event.listen(engine.sync_engine, "before_cursor_execute", capture_write)
        try:
            assert (await owner.get(zotero_path)).json()["code"] == "PDF_NOT_PREPARED"
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture_write)
        assert writes == [] and len(fake["requests"]) == before
        async with session_factory() as db:
            assert await db.get(PdfCacheEntry, updated_digest) is not None
            assert await db.get(PdfCacheBinding, UUID(zotero.json()["id"])) is not None
        assert (await owner.post(zotero_path + "/prepare")).status_code == 204
        assert (await owner.get(zotero_path)).content == PDF + b" updated"
        # LRU cap is on actual ciphertext size; deletion evicts its file and all bindings.
        monkeypatch.setattr(settings, "pdf_cache_max_bytes", 1024)
        for suffix in (b"a", b"b"):
            large_pdf = PDF + suffix * 600
            saved = await owner.post(
                base + "/pdf-import",
                content=large_pdf,
                headers={"X-PDF-Title": "LRU", "Content-Type": "application/pdf"},
            )
            assert saved.status_code == 201, saved.text
        async with session_factory() as db:
            entries = list(await db.scalars(select(PdfCacheEntry)))
            assert sum(entry.encrypted_bytes for entry in entries) <= 1024
            assert await db.get(PdfCacheEntry, digest) is None
            last_path = cache_path(settings, entries[0].storage_key)
        assert (
            await owner.request(
                "DELETE",
                base + "/" + saved.json()["id"],
                json={"expected_version": saved.json()["version"]},
            )
        ).status_code == 204
        assert not last_path.exists()
        assert (await owner.delete(dav)).status_code == 204
        assert (await owner.get(pdf_path)).json()["code"] == "WEBDAV_CONNECTION_REQUIRED"
        assert (await owner.post(pdf_path + "/prepare")).json()[
            "code"
        ] == "WEBDAV_CONNECTION_REQUIRED"
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        assert (await owner.get(pdf_path)).status_code == 404
        assert (await owner.post(pdf_path + "/prepare")).status_code == 404
        assert (
            await owner.post(
                base + "/pdf-import",
                content=PDF,
                headers={"X-PDF-Title": "Disabled", "Content-Type": "application/pdf"},
            )
        ).status_code == 404
        assert (await owner.get("/api/v1/research/pdf-usage")).status_code == 404


@pytest.mark.integration
@pytest.mark.asyncio
async def test_webdav_sliding_window_is_atomic() -> None:
    settings = get_settings()
    username = f"synthetic-rate-{uuid4()}"
    for _ in range(600):
        await enforce_rate(settings, username)
    with pytest.raises(APIError) as raised:
        await enforce_rate(settings, username)
    assert raised.value.code == "WEBDAV_RATE_LIMITED"
