import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from logion_api.config import Settings
from logion_api.content.models import Note
from logion_api.content.yjs_documents import state_from_markdown
from logion_api.errors import APIError
from logion_api.portability.crypto import ExportArtifactCipher
from logion_api.portability.models import DataExportJob
from logion_api.portability.service import PortabilityService


def test_export_derivatives_escape_bibtex_and_preserve_utf8() -> None:
    package = {
        "schema_version": "logion-export-v1",
        "product": "Logion",
        "exported_at": "2026-07-22T00:00:00+00:00",
        "workspace": {"id": "workspace", "name": "Research"},
        "scope": "requester_authorized_content",
        "excluded": ["credentials"],
        "objects": {
            "notes": [{"title": "中文笔记", "markdown_body": "# 内容"}],
            "tasks": [
                {"id": "task", "title": "T", "status": "planned"},
                {"id": "formula", "title": '=HYPERLINK("https://invalid")', "status": "planned"},
            ],
            "paper_records": [
                {
                    "citation_key": "unsafe key{}",
                    "title": "A {safe} title",
                    "source_url": "https://example.com/{paper}",
                }
            ],
        },
    }
    value = PortabilityService._zip(package)
    with zipfile.ZipFile(io.BytesIO(value)) as archive:
        assert "中文笔记" in archive.read("notes.md").decode()
        bibtex = archive.read("papers.bib").decode()
        assert "@misc{unsafe_key__" in bibtex
        assert "{safe}" not in bibtex
        tasks_csv = archive.read("tasks.csv").decode()
        assert "'=HYPERLINK" in tasks_csv
        assert "\nformula,=HYPERLINK" not in tasks_csv
        assert json.loads(archive.read("manifest.json"))["counts"]["notes"] == 1


def test_export_artifact_cipher_binds_job_workspace_and_key() -> None:
    cipher = ExportArtifactCipher(Settings())
    workspace_id, job_id = uuid4(), uuid4()
    ciphertext, nonce, key_id = cipher.encrypt(job_id, workspace_id, b"private export")
    job = DataExportJob(
        id=job_id,
        workspace_id=workspace_id,
        requested_by=uuid4(),
        artifact_ciphertext=ciphertext,
        artifact_nonce=nonce,
        artifact_encryption_key_id=key_id,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    assert cipher.decrypt(job) == b"private export"
    job.workspace_id = uuid4()
    with pytest.raises(APIError) as raised:
        cipher.decrypt(job)
    assert getattr(raised.value, "code", None) == "EXPORT_ARTIFACT_UNAVAILABLE"


def test_export_record_keeps_markdown_and_excludes_internal_crdt_state() -> None:
    actor_id = uuid4()
    note = Note(
        id=uuid4(),
        workspace_id=uuid4(),
        space_id=uuid4(),
        task_id=None,
        title="Portable note",
        markdown_body="Readable Markdown",
        yjs_state=state_from_markdown("Readable Markdown"),
        yjs_generation=3,
        version=4,
        created_by=actor_id,
        updated_by=actor_id,
    )

    record = PortabilityService._record(note)

    assert record["markdown_body"] == "Readable Markdown"
    assert "yjs_state" not in record
    assert "yjs_generation" not in record
