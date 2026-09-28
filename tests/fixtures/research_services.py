"""Loopback-only synthetic Zotero/WebDAV service for real-backend browser tests."""

import base64
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *args: object) -> None:
        pass

    def respond(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.respond(200, b"{}")
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
        else:
            self.respond(404, b"{}")

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
