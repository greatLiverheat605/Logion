import base64

import pytest
from logion_api.content.schemas import NoteDocumentUpdate
from logion_api.content.yjs_documents import (
    YjsDocumentError,
    apply_document_update,
    state_from_markdown,
)
from pycrdt import Doc, Text


def client_insert(state: bytes, index: int, value: str) -> bytes:
    document = Doc({"markdown": Text()})
    document.apply_update(state)
    before = document.get_state()
    document["markdown"].insert(index, value)
    return document.get_update(before)


def test_independent_updates_commute_and_keep_readable_markdown() -> None:
    base = state_from_markdown("first\nsecond")
    left = client_insert(base, 5, "-left")
    right = client_insert(base, len("first\nsecond"), "-right")

    left_then_right = apply_document_update(apply_document_update(base, left).state, right)
    right_then_left = apply_document_update(apply_document_update(base, right).state, left)

    assert left_then_right.markdown == right_then_left.markdown
    assert "first-left" in left_then_right.markdown
    assert "second-right" in left_then_right.markdown


def test_document_updates_reject_empty_malformed_and_oversized_content() -> None:
    state = state_from_markdown("safe")
    with pytest.raises(YjsDocumentError, match="NOTE_DOCUMENT_UPDATE_INVALID"):
        apply_document_update(state, b"")
    with pytest.raises(YjsDocumentError, match="NOTE_DOCUMENT_UPDATE_INVALID"):
        apply_document_update(state, b"not-a-yjs-update")

    payload = NoteDocumentUpdate(
        space_id="00000000-0000-7000-8000-000000000001",
        yjs_generation=1,
        update_base64=base64.b64encode(b"bounded").decode(),
    )
    assert payload.decoded_update() == b"bounded"
    noncanonical = NoteDocumentUpdate(
        space_id="00000000-0000-7000-8000-000000000001",
        yjs_generation=1,
        update_base64="ZE===",
    )
    with pytest.raises(ValueError, match="canonical base64"):
        noncanonical.decoded_update()
