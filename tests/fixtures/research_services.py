"""Loopback-only synthetic Zotero/WebDAV service for real-backend browser tests."""

import base64
import io
import json
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

PDF = Path(__file__).with_name("synthetic-reader.pdf").read_bytes()
FILES: dict[str, bytes] = {}
_buffer = io.BytesIO()
with zipfile.ZipFile(_buffer, "w") as _zip:
    _zip.writestr("synthetic.pdf", PDF)
# Mirrors the real Zotero API, which answers 400 for unsupported sort values.
ZOTERO_SORTS = frozenset(
    {
        "dateAdded",
        "dateModified",
        "title",
        "creator",
        "itemType",
        "date",
        "publisher",
        "publicationTitle",
        "journalAbbreviation",
        "language",
        "accessDate",
        "libraryCatalog",
        "callNumber",
        "rights",
        "addedBy",
        "numItems",
    }
)

FILES["/dav/zotero/A0000001.zip"] = _buffer.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *args: object) -> None:
        pass

    def respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", "application/json")
        if status != 304:
            self.send_header("Last-Modified-Version", "1")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.respond(200, b"{}")
        elif self.path.startswith("/dav/"):
            if not self.dav_authorized():
                self.respond(401, b"")
            else:
                self.respond(200 if self.path in FILES else 404, FILES.get(self.path, b""))
        elif self.path == "/keys/current":
            if self.headers.get("Zotero-API-Key") != "synthetic-zotero":
                self.respond(401, b"{}")
            else:
                self.respond(
                    200,
                    json.dumps(
                        {"userID": 123, "access": {"user": {"library": True, "write": False}}}
                    ).encode(),
                )
        elif self.path.startswith("/users/123/"):
            if self.headers.get("Zotero-API-Key") != "synthetic-zotero":
                self.respond(401, b"{}")
                return
            if self.headers.get("If-Modified-Since-Version") == "1":
                self.respond(304, b"")
                return
            path = urlsplit(self.path)
            query = parse_qs(path.query)
            if query.get("sort", ["dateModified"])[0] not in ZOTERO_SORTS:
                self.respond(400, b"Invalid 'sort' value")
                return
            item = {
                "key": "P0000001",
                "version": 1,
                "data": {
                    "title": "Synthetic synchronized paper",
                    "itemType": "journalArticle",
                    "DOI": "10.1234/synthetic-sync",
                    "collections": ["C0000001"],
                },
            }
            pages = {
                "/users/123/collections": [
                    {"key": "C0000001", "version": 1, "data": {"name": "Examples"}}
                ],
                "/users/123/items/top": [item],
                "/users/123/deleted": {"items": [], "collections": []},
            }
            if query.get("itemType") == ["attachment"]:
                data = [
                    {
                        "key": "A0000001",
                        "version": 1,
                        "data": {
                            "parentItem": "P0000001",
                            "contentType": "application/pdf",
                        },
                    }
                ]
            elif query.get("itemType") == ["annotation"]:
                data = [
                    {
                        "key": "N0000001",
                        "version": 1,
                        "data": {
                            "parentItem": "A0000001",
                            "annotationText": "Synthetic excerpt",
                            "annotationPosition": '{"pageIndex":0}',
                        },
                    }
                ]
            else:
                data = pages.get(path.path, [])
            self.respond(200, json.dumps(data).encode())
        else:
            self.respond(404, b"{}")

    def dav_authorized(self) -> bool:
        expected = base64.b64encode(b"synthetic-account:synthetic-webdav").decode()
        return self.headers.get("Authorization") == f"Basic {expected}"

    def do_MKCOL(self) -> None:  # noqa: N802
        self.respond(201 if self.dav_authorized() and self.path == "/dav/Logion" else 403, b"")

    def do_PUT(self) -> None:  # noqa: N802
        if not self.dav_authorized() or not self.path.startswith("/dav/Logion/"):
            self.respond(403, b"")
            return
        size = int(self.headers.get("Content-Length", "0"))
        if not 0 < size <= 104857600:
            self.respond(413, b"")
            return
        FILES[self.path] = self.rfile.read(size)
        self.respond(201, b"")

    def do_PROPFIND(self) -> None:  # noqa: N802
        expected = base64.b64encode(b"synthetic-account:synthetic-webdav").decode()
        self.respond(
            207
            if self.path == "/dav/" and self.headers.get("Authorization") == f"Basic {expected}"
            else 401,
            b"{}",
        )


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8192), Handler).serve_forever()
