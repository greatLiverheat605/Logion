from uuid import uuid4

import pytest
from logion_api.content.schemas import NoteWriteRequest, ResourceCreateRequest
from pydantic import ValidationError


def test_note_contract_is_strict_and_bounded() -> None:
    with pytest.raises(ValidationError):
        NoteWriteRequest.model_validate(
            {"id": str(uuid4()), "title": "Note", "markdown_body": "safe", "html": "<script>"}
        )
    with pytest.raises(ValidationError):
        NoteWriteRequest.model_validate(
            {"id": str(uuid4()), "title": "Note", "markdown_body": "x" * 500_001}
        )


def test_resource_contract_separates_links_and_pdf_indexes() -> None:
    link = ResourceCreateRequest.model_validate(
        {
            "id": str(uuid4()),
            "resource_type": "link",
            "title": "Documentation",
            "source_url": "https://example.com/docs",
        }
    )
    assert link.page_index == []
    with pytest.raises(ValidationError):
        ResourceCreateRequest.model_validate(
            {
                "id": str(uuid4()),
                "resource_type": "link",
                "title": "Unsafe",
                "source_url": "javascript:alert(1)",
            }
        )
    with pytest.raises(ValidationError, match="unique"):
        ResourceCreateRequest.model_validate(
            {
                "id": str(uuid4()),
                "resource_type": "pdf_index",
                "title": "Paper",
                "pdf_filename": "paper.pdf",
                "page_count": 2,
                "page_index": [
                    {"page": 1, "label": "Method"},
                    {"page": 1, "label": "Result"},
                ],
            }
        )
