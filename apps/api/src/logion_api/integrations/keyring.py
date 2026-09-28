from __future__ import annotations

import base64
import binascii
import re
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

if TYPE_CHECKING:
    from logion_api.errors import APIError


class IntegrationKeyring(BaseModel):
    model_config = ConfigDict(extra="forbid")
    active: str | None = None
    keys: dict[str, SecretStr] = Field(default_factory=dict, repr=False)

    @model_validator(mode="after")
    def validate_keys(self) -> IntegrationKeyring:
        if self.active is not None and self.active not in self.keys:
            raise ValueError("The active key must be configured")
        for name, value in self.keys.items():
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
                raise ValueError("Invalid key identifier")
            try:
                raw = value.get_secret_value()
                decoded = base64.b64decode(
                    raw + "=" * (-len(raw) % 4), altchars=b"-_", validate=True
                )
                if len(decoded) != 32:
                    raise ValueError("Key must decode to 32 bytes")
            except (binascii.Error, ValueError) as exc:
                raise ValueError("Key must be base64url encoded 32 bytes") from exc
        return self

    def key(self, key_id: str | None) -> bytes:
        if key_id is None or key_id not in self.keys:
            raise unavailable()
        raw = self.keys[key_id].get_secret_value()
        return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def unavailable() -> APIError:
    # Configuration imports this model before the API error module is initialized.
    from logion_api.errors import APIError  # noqa: PLC0415

    return APIError(
        code="INTEGRATION_KEY_UNAVAILABLE",
        message="Integration encryption is unavailable.",
        status_code=503,
    )


@dataclass(frozen=True)
class Envelope:
    ciphertext: bytes
    nonce: bytes
    wrapped_key: bytes
    key_nonce: bytes
    key_id: str


def encrypt(keyring: IntegrationKeyring, plaintext: bytes, *, aad: bytes) -> Envelope:
    wrapping = keyring.key(keyring.active)
    assert keyring.active is not None
    data_key = AESGCM.generate_key(bit_length=256)
    nonce, key_nonce = secrets.token_bytes(12), secrets.token_bytes(12)
    return Envelope(
        AESGCM(data_key).encrypt(nonce, plaintext, aad),
        nonce,
        AESGCM(wrapping).encrypt(key_nonce, data_key, aad + b":key:" + keyring.active.encode()),
        key_nonce,
        keyring.active,
    )


def decrypt(keyring: IntegrationKeyring, envelope: Envelope, *, aad: bytes) -> bytes:
    try:
        key = AESGCM(keyring.key(envelope.key_id)).decrypt(
            envelope.key_nonce,
            envelope.wrapped_key,
            aad + b":key:" + envelope.key_id.encode(),
        )
        return AESGCM(key).decrypt(envelope.nonce, envelope.ciphertext, aad)
    except (InvalidTag, ValueError) as exc:
        raise unavailable() from exc
