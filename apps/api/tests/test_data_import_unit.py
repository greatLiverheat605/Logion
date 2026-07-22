from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from logion_api.config import Settings
from logion_api.errors import APIError
from logion_api.portability.crypto import ImportPreviewCipher
from logion_api.portability.import_service import ImportService
from logion_api.portability.models import DataImportPreview
from logion_api.portability.schemas import ImportPreviewCreate
from logion_api.workspaces.service import WorkspaceService


def service() -> ImportService:
    settings = Settings()
    return ImportService(settings, WorkspaceService(settings))


@pytest.mark.parametrize(
    ("source_format", "filename", "content", "kind"),
    [
        ("markdown", "notes.md", "# Learning\nBody", "note"),
        ("csv", "inbox.csv", "title,note\nRead paper,Important", "inbox_item"),
        (
            "bibtex",
            "papers.bib",
            "@misc{paper_1,\n  title = {A paper},\n  url = {https://example.com/paper}\n}",
            "paper",
        ),
        (
            "logion_json",
            "data.json",
            '{"schema_version":"logion-export-v1","objects":{"notes":[{"title":"N","markdown_body":"B"}]}}',
            "note",
        ),
    ],
)
def test_bounded_import_formats_normalize_without_external_actions(
    source_format: str, filename: str, content: str, kind: str
) -> None:
    payload = ImportPreviewCreate.model_validate(
        {
            "id": str(uuid4()),
            "source_format": source_format,
            "source_filename": filename,
            "content": content,
        }
    )
    records, _warnings = service()._parse(payload)
    assert records[0].kind == kind


def test_import_rejects_remote_credentials_nul_and_unknown_schema() -> None:
    cases = [
        {
            "source_format": "bibtex",
            "source_filename": "papers.bib",
            "content": "@misc{x,\n title = {X},\n url = {https://user:pass@example.com/x}\n}",
        },
        {
            "source_format": "markdown",
            "source_filename": "note.md",
            "content": "bad\x00content",
        },
        {
            "source_format": "logion_json",
            "source_filename": "data.json",
            "content": '{"schema_version":"future","objects":{}}',
        },
    ]
    for case in cases:
        payload = ImportPreviewCreate.model_validate({"id": str(uuid4()), **case})
        with pytest.raises(APIError) as raised:
            service()._parse(payload)
        assert raised.value.code == "IMPORT_SOURCE_INVALID"


def test_import_preview_cipher_is_bound_to_workspace() -> None:
    cipher = ImportPreviewCipher(Settings())
    preview_id, workspace_id = uuid4(), uuid4()
    ciphertext, nonce, key_id = cipher.encrypt_preview(
        preview_id, workspace_id, b'[{"kind":"note"}]'
    )
    preview = DataImportPreview(
        id=preview_id,
        workspace_id=workspace_id,
        requested_by=uuid4(),
        source_format="logion_json",
        source_filename="data.json",
        source_sha256="0" * 64,
        normalized_ciphertext=ciphertext,
        normalized_nonce=nonce,
        normalized_encryption_key_id=key_id,
        counts={"note": 1},
        warnings=[],
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    assert cipher.decrypt_preview(preview) == b'[{"kind":"note"}]'
    preview.workspace_id = uuid4()
    with pytest.raises(APIError) as raised:
        cipher.decrypt_preview(preview)
    assert raised.value.code == "IMPORT_PREVIEW_UNAVAILABLE"
