import base64
import json
import secrets
from dataclasses import dataclass
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from logion_api.ai_gateway.models import AIRun
from logion_api.config import Settings
from logion_api.errors import APIError


@dataclass(frozen=True)
class EncryptedRunInput:
    ciphertext: bytes
    nonce: bytes
    data_key_ciphertext: bytes
    data_key_nonce: bytes
    encryption_key_id: str


class AIRunInputCipher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def encrypt(
        self, workspace_id: UUID, run_id: UUID, fields: dict[str, str]
    ) -> EncryptedRunInput:
        plaintext = json.dumps(
            fields, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
        key_id = self._settings.ai_credential_active_encryption_key_id
        wrapping_key = self._key(key_id)
        data_key = AESGCM.generate_key(bit_length=256)
        nonce = secrets.token_bytes(12)
        data_key_nonce = secrets.token_bytes(12)
        return EncryptedRunInput(
            ciphertext=AESGCM(data_key).encrypt(
                nonce, plaintext, self._input_aad(workspace_id, run_id)
            ),
            nonce=nonce,
            data_key_ciphertext=AESGCM(wrapping_key).encrypt(
                data_key_nonce,
                data_key,
                self._key_aad(workspace_id, run_id, key_id),
            ),
            data_key_nonce=data_key_nonce,
            encryption_key_id=key_id,
        )

    def decrypt(self, run: AIRun) -> dict[str, str]:
        values = (
            run.input_ciphertext,
            run.input_nonce,
            run.input_data_key_ciphertext,
            run.input_data_key_nonce,
            run.input_encryption_key_id,
        )
        if any(value is None for value in values):
            raise self._unavailable()
        try:
            ciphertext, nonce, data_key_ciphertext, data_key_nonce, key_id = values
            assert isinstance(ciphertext, bytes)
            assert isinstance(nonce, bytes)
            assert isinstance(data_key_ciphertext, bytes)
            assert isinstance(data_key_nonce, bytes)
            assert isinstance(key_id, str)
            data_key = AESGCM(self._key(key_id)).decrypt(
                data_key_nonce,
                data_key_ciphertext,
                self._key_aad(run.workspace_id, run.id, key_id),
            )
            plaintext = AESGCM(data_key).decrypt(
                nonce,
                ciphertext,
                self._input_aad(run.workspace_id, run.id),
            )
            payload = json.loads(plaintext)
            if not isinstance(payload, dict) or not all(
                isinstance(key, str) and isinstance(value, str) for key, value in payload.items()
            ):
                raise ValueError("invalid run input")
            return payload
        except (AssertionError, InvalidTag, UnicodeDecodeError, ValueError, KeyError) as exc:
            raise self._unavailable() from exc

    def _key(self, key_id: str) -> bytes:
        value = self._settings.ai_credential_encryption_keys[key_id].get_secret_value()
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    @staticmethod
    def _input_aad(workspace_id: UUID, run_id: UUID) -> bytes:
        return f"logion:ai-run-input:v1:{workspace_id}:{run_id}".encode()

    @staticmethod
    def _key_aad(workspace_id: UUID, run_id: UUID, key_id: str) -> bytes:
        return f"logion:ai-run-data-key:v1:{workspace_id}:{run_id}:{key_id}".encode()

    @staticmethod
    def _unavailable() -> APIError:
        return APIError(
            code="AI_RUN_INPUT_UNAVAILABLE",
            message="The encrypted AI run input is unavailable.",
            status_code=503,
            retryable=False,
        )
