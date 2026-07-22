import base64
import ipaddress
import secrets
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit, urlunsplit
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from logion_api.ai_gateway.models import AIProvider
from logion_api.config import Settings
from logion_api.errors import APIError


@dataclass(frozen=True)
class EncryptedCredential:
    credential_ciphertext: bytes
    credential_nonce: bytes
    data_key_ciphertext: bytes
    data_key_nonce: bytes
    encryption_key_id: str


class AIProviderCredentialCipher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def encrypt(
        self, workspace_id: UUID, provider_id: UUID, credential: str
    ) -> EncryptedCredential:
        key_id = self._settings.ai_credential_active_encryption_key_id
        key = self._decode_key(key_id)
        data_key = AESGCM.generate_key(bit_length=256)
        credential_nonce = secrets.token_bytes(12)
        data_key_nonce = secrets.token_bytes(12)
        credential_ciphertext = AESGCM(data_key).encrypt(
            credential_nonce,
            credential.encode("utf-8"),
            self._credential_aad(workspace_id, provider_id),
        )
        data_key_ciphertext = AESGCM(key).encrypt(
            data_key_nonce,
            data_key,
            self._data_key_aad(workspace_id, provider_id, key_id),
        )
        return EncryptedCredential(
            credential_ciphertext=credential_ciphertext,
            credential_nonce=credential_nonce,
            data_key_ciphertext=data_key_ciphertext,
            data_key_nonce=data_key_nonce,
            encryption_key_id=key_id,
        )

    def decrypt(self, provider: AIProvider) -> str:
        if any(
            value is None
            for value in (
                provider.credential_ciphertext,
                provider.credential_nonce,
                provider.data_key_ciphertext,
                provider.data_key_nonce,
                provider.encryption_key_id,
            )
        ):
            raise self._unavailable()
        try:
            key_id = provider.encryption_key_id
            credential_nonce = provider.credential_nonce
            credential_ciphertext = provider.credential_ciphertext
            data_key_nonce = provider.data_key_nonce
            data_key_ciphertext = provider.data_key_ciphertext
            assert all(
                value is not None
                for value in (
                    key_id,
                    credential_nonce,
                    credential_ciphertext,
                    data_key_nonce,
                    data_key_ciphertext,
                )
            )
            assert isinstance(key_id, str)
            assert isinstance(credential_nonce, bytes)
            assert isinstance(credential_ciphertext, bytes)
            assert isinstance(data_key_nonce, bytes)
            assert isinstance(data_key_ciphertext, bytes)
            key = self._decode_key(key_id)
            data_key = AESGCM(key).decrypt(
                data_key_nonce,
                data_key_ciphertext,
                self._data_key_aad(provider.workspace_id, provider.id, key_id),
            )
            plaintext = AESGCM(data_key).decrypt(
                credential_nonce,
                credential_ciphertext,
                self._credential_aad(provider.workspace_id, provider.id),
            )
            return plaintext.decode("utf-8")
        except (AssertionError, InvalidTag, UnicodeDecodeError, ValueError, KeyError) as exc:
            raise self._unavailable() from exc

    def _decode_key(self, key_id: str) -> bytes:
        encoded = self._settings.ai_credential_encryption_keys[key_id].get_secret_value()
        return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))

    @staticmethod
    def _credential_aad(workspace_id: UUID, provider_id: UUID) -> bytes:
        return f"logion:ai-provider-credential:v1:{workspace_id}:{provider_id}".encode()

    @staticmethod
    def _data_key_aad(workspace_id: UUID, provider_id: UUID, key_id: str) -> bytes:
        return f"logion:ai-provider-data-key:v1:{workspace_id}:{provider_id}:{key_id}".encode()

    @staticmethod
    def _unavailable() -> APIError:
        return APIError(
            code="AI_PROVIDER_KEY_UNAVAILABLE",
            message="The AI Provider credential is temporarily unavailable.",
            status_code=503,
            retryable=True,
        )


def validate_provider_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("base URL is invalid") from exc
    if parsed.scheme != "https" or not hostname:
        raise ValueError("base URL must use HTTPS")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("base URL cannot include user information")
    if parsed.query or parsed.fragment:
        raise ValueError("base URL cannot include a query or fragment")
    if port not in {None, 443, 8443}:
        raise ValueError("base URL port is not allowed")
    try:
        ascii_hostname = hostname.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("base URL hostname is invalid") from exc
    blocked_suffixes = (".localhost", ".local", ".internal", ".home.arpa")
    if ascii_hostname == "localhost" or ascii_hostname.endswith(blocked_suffixes):
        raise ValueError("base URL hostname is not public")
    try:
        address = ipaddress.ip_address(ascii_hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("base URL address is not public")
    decoded_path = unquote(parsed.path)
    if "\\" in decoded_path or ".." in decoded_path.split("/"):
        raise ValueError("base URL path is invalid")
    host_for_url = f"[{ascii_hostname}]" if ":" in ascii_hostname else ascii_hostname
    netloc = f"{host_for_url}:{port}" if port is not None and port != 443 else host_for_url
    path = parsed.path.rstrip("/")
    return urlunsplit(("https", netloc, path, "", ""))
