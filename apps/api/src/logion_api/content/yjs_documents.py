from dataclasses import dataclass

from pycrdt import Doc, Text

MAX_MARKDOWN_CHARS = 500_000
MAX_YJS_UPDATE_BYTES = 180_000


class YjsDocumentError(ValueError):
    pass


@dataclass(frozen=True)
class YjsDocumentSnapshot:
    state: bytes
    markdown: str


def state_from_markdown(markdown: str) -> bytes:
    if len(markdown) > MAX_MARKDOWN_CHARS:
        raise YjsDocumentError("NOTE_DOCUMENT_TOO_LARGE")
    document = Doc({"markdown": Text(markdown)})
    return document.get_update()


def apply_document_update(
    current_state: bytes,
    update: bytes,
) -> YjsDocumentSnapshot:
    if not update or len(update) > MAX_YJS_UPDATE_BYTES:
        raise YjsDocumentError("NOTE_DOCUMENT_UPDATE_INVALID")
    try:
        document = Doc({"markdown": Text()})
        document.apply_update(current_state)
        document.apply_update(update)
        markdown = str(document["markdown"])
        if len(markdown) > MAX_MARKDOWN_CHARS:
            raise YjsDocumentError("NOTE_DOCUMENT_TOO_LARGE")
        return YjsDocumentSnapshot(state=document.get_update(), markdown=markdown)
    except YjsDocumentError:
        raise
    except Exception as exc:
        raise YjsDocumentError("NOTE_DOCUMENT_UPDATE_INVALID") from exc
