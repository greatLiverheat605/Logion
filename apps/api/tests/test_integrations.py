import base64
import json
import ssl
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from uuid import UUID, uuid4

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from httpx import ASGITransport, AsyncClient
from logion_api.config import Settings, get_settings
from logion_api.db import session_factory
from logion_api.errors import APIError
from logion_api.identity.models import AuditEvent, AuthSession
from logion_api.integrations.keyring import IntegrationKeyring, decrypt, encrypt
from logion_api.integrations.models import IntegrationCredential
from logion_api.integrations.network import request_integration
from logion_api.main import app
from sqlalchemy import select, update


def test_keyring_envelope_is_bound_to_owner_and_supports_rotation() -> None:
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode()
    ring = IntegrationKeyring(active="v1", keys={"v1": encoded})
    envelope = encrypt(ring, b"synthetic-credential", aad=b"owner-one:zotero")
    assert b"synthetic-credential" not in envelope.ciphertext
    assert decrypt(ring, envelope, aad=b"owner-one:zotero") == b"synthetic-credential"
    with pytest.raises(APIError, match="unavailable"):
        decrypt(ring, envelope, aad=b"owner-two:zotero")
    rotated = IntegrationKeyring(
        active="v2", keys={"v1": encoded, "v2": base64.urlsafe_b64encode(b"z" * 32).decode()}
    )
    assert decrypt(rotated, envelope, aad=b"owner-one:zotero") == b"synthetic-credential"
    assert encrypt(rotated, b"new", aad=b"owner-one:zotero").key_id == "v2"
    with pytest.raises(APIError):
        encrypt(IntegrationKeyring(), b"synthetic", aad=b"owner-one")


@pytest.fixture
def fake_integrations(
    request: pytest.FixtureRequest, tmp_path: Path
) -> Iterator[tuple[str, dict[str, object]]]:
    state: dict[str, object] = {"write": False, "status": 200, "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            pass

        def do_GET(self) -> None:  # noqa: N802
            if self.headers.get("Zotero-API-Key") != "synthetic-zotero":
                self.send_error(401)
                return
            self.respond()

        def do_PROPFIND(self) -> None:  # noqa: N802
            expected = base64.b64encode(b"synthetic-account:synthetic-webdav").decode()
            if self.headers.get("Authorization") != f"Basic {expected}":
                self.send_error(401)
                return
            self.respond()

        def respond(self) -> None:
            requests = state["requests"]
            assert isinstance(requests, list)
            requests.append((self.command, self.path))
            if self.command == "GET":
                body = json.dumps(
                    {"userID": 123, "access": {"user": {"library": True, "write": state["write"]}}}
                ).encode()
            else:
                body = b"<multistatus/>"
            self.send_response(int(str(state["status"])))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Location", "https://untrusted.example.com/")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    scheme = "http"
    if getattr(request, "param", False):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "synthetic.example.com")])
        now = datetime.now(UTC)
        certificate = (
            x509.CertificateBuilder()
            .subject_name(name)
            .issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(hours=1))
            .sign(key, hashes.SHA256())
        )
        cert_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
        cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert_path, key_path)
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"{scheme}://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("fake_integrations", [True], indirect=True)
@pytest.mark.asyncio
async def test_tls_verification_cannot_be_disabled_even_for_test_endpoints(
    fake_integrations: tuple[str, dict[str, object]],
) -> None:
    origin, state = fake_integrations
    settings = Settings(_env_file=None, env="test", zotero_origin=origin)
    with pytest.raises(APIError) as raised:
        await request_integration(
            settings,
            "zotero",
            "GET",
            "/keys/current",
            headers={"Zotero-API-Key": "synthetic-zotero"},
        )
    assert raised.value.code == "INTEGRATION_UNAVAILABLE"
    assert state["requests"] == []


@pytest.mark.asyncio
async def test_network_blocks_hosts_redirects_oversize_and_zotero_writes(
    fake_integrations: tuple[str, dict[str, object]],
) -> None:
    origin, state = fake_integrations
    settings = Settings(_env_file=None, env="test", zotero_origin=origin)
    headers = {"Zotero-API-Key": "synthetic-zotero"}
    response = await request_integration(
        settings, "zotero", "GET", "/keys/current", headers=headers
    )
    assert response.status == 200
    for method, path, code in [
        ("POST", "/keys/current", "INTEGRATION_READ_ONLY"),
        ("GET", "//untrusted.example.com/", "INTEGRATION_PATH_BLOCKED"),
        ("GET", "/../keys/current", "INTEGRATION_PATH_BLOCKED"),
    ]:
        with pytest.raises(APIError) as raised:
            await request_integration(settings, "zotero", method, path, headers=headers)
        assert raised.value.code == code
    with pytest.raises(APIError) as raised:
        await request_integration(
            settings, "zotero", "GET", "/keys/current", headers=headers, max_bytes=1
        )
    assert raised.value.code == "INTEGRATION_RESPONSE_TOO_LARGE"
    state["status"] = 302
    with pytest.raises(APIError) as raised:
        await request_integration(settings, "zotero", "GET", "/keys/current", headers=headers)
    assert raised.value.code == "INTEGRATION_REDIRECT_BLOCKED"
    settings.env = "development"
    with pytest.raises(APIError) as raised:
        await request_integration(settings, "zotero", "GET", "/keys/current", headers=headers)
    assert raised.value.code == "INTEGRATION_HOST_BLOCKED"
    assert len(state["requests"]) == 3  # type: ignore[arg-type]
    defaults = Settings(_env_file=None)
    assert defaults.zotero_origin == "https://api.zotero.org"
    assert defaults.webdav_origin == "https://dav.jianguoyun.com"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_credentials_are_private_encrypted_revocable_and_never_echoed(
    monkeypatch: pytest.MonkeyPatch, fake_integrations: tuple[str, dict[str, object]]
) -> None:
    origin, fake = fake_integrations
    settings = get_settings()
    monkeypatch.setattr(settings, "research_v3_enabled", True)
    monkeypatch.setattr(settings, "env", "test")
    monkeypatch.setattr(settings, "zotero_origin", origin)
    monkeypatch.setattr(settings, "webdav_origin", origin)
    monkeypatch.setattr(
        settings,
        "integration_keyring",
        IntegrationKeyring(
            active="test", keys={"test": base64.urlsafe_b64encode(b"k" * 32).decode()}
        ),
    )
    async with (
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.210", 48001)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as owner,
        AsyncClient(
            transport=ASGITransport(app=app, client=("192.0.2.211", 48002)),
            base_url="http://test",
            headers={"Origin": "http://test"},
        ) as peer,
    ):
        for client in (owner, peer):
            response = await client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"integration-{uuid4()}@example.com",
                    "password": "Synthetic-password-42!",
                    "device_name": "synthetic",
                },
            )
            assert response.status_code == 201, response.text
        owner_id = UUID((await owner.get("/api/v1/auth/me")).json()["id"])
        csrf = {"X-CSRF-Token": owner.cookies["logion_csrf"]}
        path = "/api/v1/research/integrations/zotero"
        body = {"credential": "synthetic-zotero"}
        assert (await owner.put(path, json=body)).status_code == 403
        assert (
            await owner.put(
                path, json=body, headers={**csrf, "Origin": "https://untrusted.example.com"}
            )
        ).status_code == 403
        saved = await owner.put(path, json=body, headers=csrf)
        assert saved.status_code == 200, saved.text
        assert saved.json()["configured"] is True
        assert saved.json()["connected"] is False
        assert "synthetic" not in saved.text
        assert (await peer.get(path)).json()["configured"] is False
        peer_csrf = {"X-CSRF-Token": peer.cookies["logion_csrf"]}
        assert (await peer.delete(path, headers=peer_csrf)).status_code == 204
        assert (await owner.get(path)).json()["configured"] is True
        async with session_factory() as db:
            row = await db.scalar(
                select(IntegrationCredential).where(IntegrationCredential.user_id == owner_id)
            )
            assert row and b"synthetic-zotero" not in row.ciphertext
            assert (
                json.loads(decrypt(settings.integration_keyring, row.envelope, aad=row.aad))[
                    "credential"
                ]
                == body["credential"]
            )
        checked = await owner.post(path + "/test", headers=csrf)
        assert checked.status_code == 200
        assert checked.json()["connected"] is True
        assert "synthetic" not in checked.text
        fake["write"] = True
        checked = await owner.post(path + "/test", headers=csrf)
        assert checked.json()["connected"] is False
        assert checked.json()["last_error_code"] == "ZOTERO_READ_ONLY_KEY_REQUIRED"
        dav = "/api/v1/research/integrations/webdav"
        assert (
            await owner.put(
                dav,
                json={"username": "synthetic-account", "credential": "synthetic-webdav"},
                headers=csrf,
            )
        ).status_code == 200
        assert (await owner.post(dav + "/test", headers=csrf)).json()["connected"] is True
        assert (await owner.delete(path, headers=csrf)).status_code == 204
        assert (await owner.get(path)).json()["configured"] is False
        async with session_factory() as db:
            assert (
                await db.scalar(
                    select(IntegrationCredential).where(
                        IntegrationCredential.user_id == owner_id,
                        IntegrationCredential.provider == "zotero",
                    )
                )
                is None
            )
            events = (
                await db.scalars(
                    select(AuditEvent).where(
                        AuditEvent.actor_id == owner_id, AuditEvent.event_type.like("integration.%")
                    )
                )
            ).all()
            assert len(events) == 6
            assert all(
                event.event_metadata == {"provider": "zotero"}
                or event.event_metadata == {"provider": "webdav"}
                for event in events
            )
            assert "synthetic" not in json.dumps([e.event_metadata for e in events])
            await db.execute(
                update(AuthSession)
                .where(AuthSession.user_id == owner_id)
                .values(created_at=datetime.now(UTC) - timedelta(hours=1))
            )
            await db.commit()
        for method, url in [("PUT", dav), ("DELETE", dav), ("POST", dav + "/test")]:
            response = await owner.request(
                method,
                url,
                headers=csrf,
                json={"username": "synthetic-account", "credential": "synthetic-webdav"}
                if method == "PUT"
                else None,
            )
            assert response.status_code == 403
            assert response.json()["code"] == "AUTH_RECENT_LOGIN_REQUIRED"
        monkeypatch.setattr(settings, "research_v3_enabled", False)
        for method, url in [
            ("GET", path),
            ("PUT", path),
            ("DELETE", path),
            ("POST", path + "/test"),
        ]:
            response = await owner.request(
                method, url, headers=csrf, json=body if method == "PUT" else None
            )
            assert response.status_code == 404
