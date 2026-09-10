import asyncio
import json
import ssl
from datetime import UTC, datetime, timedelta
from pathlib import Path

import anyio
import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from logion_api.ai_gateway.adapter import OpenAICompatibleDiscoveryAdapter
from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.errors import APIError


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["discovery", "generation"])
@pytest.mark.parametrize("certificate_host", ["api.example.com", "wrong.example.com"])
async def test_provider_uses_real_tls_and_verifies_original_hostname(
    kind: str, certificate_host: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, certificate_host)])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(certificate_host)]), False)
        .sign(key, hashes.SHA256())
    )
    certificate_path, key_path = tmp_path / "cert.pem", tmp_path / "key.pem"
    certificate_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_context.load_cert_chain(certificate_path, key_path)
    sni_names: list[str | None] = []
    server_context.set_servername_callback(lambda _socket, host, _context: sni_names.append(host))
    client_context = ssl.create_default_context(cafile=str(certificate_path))
    requests: list[bytes] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            headers = await reader.readuntil(b"\r\n\r\n")
            requests.append(headers)
            for line in headers.split(b"\r\n"):
                if line.lower().startswith(b"content-length:"):
                    await reader.readexactly(int(line.split(b":", 1)[1]))
            body = json.dumps(
                {"data": [{"id": "model-a"}]}
                if kind == "discovery"
                else {
                    "choices": [{"message": {"content": '{"summary":"draft only"}'}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 5},
                }
            ).encode()
            writer.write(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    async def resolver(host: str, port: int) -> list[str]:
        assert (host, port) == ("api.example.com", 443)
        return ["93.184.216.34"]

    async def not_cancelled() -> bool:
        return False

    server = await asyncio.start_server(handle, "127.0.0.1", 0, ssl=server_context)
    local_port = server.sockets[0].getsockname()[1]
    connect_tcp = anyio.connect_tcp

    async def connect_local(
        *, remote_host: str, remote_port: int, **kwargs: object
    ) -> anyio.abc.SocketStream:
        assert (remote_host, remote_port) == ("93.184.216.34", 443)
        return await connect_tcp("127.0.0.1", local_port)

    # Redirect only the socket in this test; keep HTTPX, AnyIO TLS and certificate checks real.
    monkeypatch.setattr(anyio, "connect_tcp", connect_local)

    def transport() -> httpx.AsyncHTTPTransport:
        return httpx.AsyncHTTPTransport(verify=client_context)

    if kind == "discovery":
        operation = OpenAICompatibleDiscoveryAdapter(
            resolver=resolver, transport_factory=transport
        ).discover(base_url="https://api.example.com/v1", credential="synthetic", timeout_seconds=5)
    else:
        operation = OpenAICompatibleGenerationAdapter(
            resolver=resolver, transport_factory=transport
        ).generate(
            base_url="https://api.example.com/v1",
            credential="synthetic",
            provider_model_id="model-a",
            input_fields={"note": "synthetic"},
            expected_output_fields=["summary"],
            max_output_tokens=100,
            timeout_seconds=5,
            cancelled=not_cancelled,
        )
    async with server:
        if certificate_host == "api.example.com":
            result = await operation
            if kind == "discovery":
                assert [row.provider_model_id for row in result] == ["model-a"]
            else:
                assert result.output == {"summary": "draft only"}
            assert len(requests) == 1
            assert b"Host: api.example.com\r\n" in requests[0]
            assert b"Authorization: Bearer synthetic\r\n" in requests[0]
        else:
            with pytest.raises(APIError) as raised:
                await operation
            assert raised.value.code == "AI_PROVIDER_UNAVAILABLE"
            assert requests == []
    assert sni_names == ["api.example.com"]
