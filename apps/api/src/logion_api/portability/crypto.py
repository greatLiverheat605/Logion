import base64
import secrets
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.portability.models import DataExportJob, DataImportPreview


class ExportArtifactCipher:
    def __init__(self, settings: Settings) -> None:
        self._active_key_id = settings.data_export_active_encryption_key_id
        self._keys = {
            key_id: self._decode(value.get_secret_value())
            for key_id, value in settings.data_export_encryption_keys.items()
        }

    def encrypt(self, job_id: UUID, workspace_id: UUID, value: bytes) -> tuple[bytes, bytes, str]:
        nonce = secrets.token_bytes(12)
        return (
            AESGCM(self._keys[self._active_key_id]).encrypt(
                nonce, value, self._aad(job_id, workspace_id, self._active_key_id)
            ),
            nonce,
            self._active_key_id,
        )

    def decrypt(self, job: DataExportJob) -> bytes:
        if (
            job.artifact_ciphertext is None
            or job.artifact_nonce is None
            or job.artifact_encryption_key_id is None
            or job.artifact_encryption_key_id not in self._keys
        ):
            raise self._unavailable()
        try:
            return AESGCM(self._keys[job.artifact_encryption_key_id]).decrypt(
                job.artifact_nonce,
                job.artifact_ciphertext,
                self._aad(job.id, job.workspace_id, job.artifact_encryption_key_id),
            )
        except InvalidTag as exc:
            raise self._unavailable() from exc

    @staticmethod
    def _decode(value: str) -> bytes:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

    @staticmethod
    def _aad(job_id: UUID, workspace_id: UUID, key_id: str) -> bytes:
        return f"logion:data-export:v1:{workspace_id}:{job_id}:{key_id}".encode()

    @staticmethod
    def _unavailable() -> APIError:
        return APIError(
            code="EXPORT_ARTIFACT_UNAVAILABLE",
            message="The export artifact is unavailable.",
            status_code=503,
        )


class ImportPreviewCipher(ExportArtifactCipher):
    def encrypt_preview(
        self, preview_id: UUID, workspace_id: UUID, value: bytes
    ) -> tuple[bytes, bytes, str]:
        nonce = secrets.token_bytes(12)
        return (
            AESGCM(self._keys[self._active_key_id]).encrypt(
                nonce,
                value,
                self._preview_aad(preview_id, workspace_id, self._active_key_id),
            ),
            nonce,
            self._active_key_id,
        )

    def decrypt_preview(self, preview: DataImportPreview) -> bytes:
        key_id = preview.normalized_encryption_key_id
        if (
            preview.normalized_ciphertext is None
            or preview.normalized_nonce is None
            or key_id is None
            or key_id not in self._keys
        ):
            raise self._unavailable()
        try:
            return AESGCM(self._keys[key_id]).decrypt(
                preview.normalized_nonce,
                preview.normalized_ciphertext,
                self._preview_aad(preview.id, preview.workspace_id, key_id),
            )
        except InvalidTag as exc:
            raise self._unavailable() from exc

    @staticmethod
    def _preview_aad(preview_id: UUID, workspace_id: UUID, key_id: str) -> bytes:
        return f"logion:data-import-preview:v1:{workspace_id}:{preview_id}:{key_id}".encode()

    @staticmethod
    def _unavailable() -> APIError:
        return APIError(
            code="IMPORT_PREVIEW_UNAVAILABLE",
            message="The encrypted import preview is unavailable.",
            status_code=503,
        )
