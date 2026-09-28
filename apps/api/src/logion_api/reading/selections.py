from logion_api.errors import APIError
from logion_api.library.text_models import SourceText


def selected_text(source: SourceText, start: int, end: int) -> str:
    if start < 0 or end <= start or end > len(source.text):
        raise APIError(
            code="SOURCE_SELECTION_INVALID",
            message="Selection does not match source text.",
            status_code=422,
        )
    value = source.text[start:end]
    if not value.strip() or len(value) > 20000 or len(value.encode("utf-8")) > 32768:
        raise APIError(
            code="SOURCE_SELECTION_INVALID",
            message="Select at most 20,000 characters and 32 KiB.",
            status_code=422,
        )
    return value
