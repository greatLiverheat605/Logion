import io
import re
import stat
import zipfile
from pathlib import PurePosixPath

from logion_api.integrations.network import integration_error


def validate_pdf(data: bytes, limit: int) -> bytes:
    if len(data) > limit:
        raise integration_error("PDF_TOO_LARGE", 413)
    if not data.startswith(b"%PDF"):
        raise integration_error("PDF_INVALID")
    return data


def unzip_pdf(data: bytes, limit: int) -> bytes:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            # No sidecars, directories, links, encrypted entries or alternative codecs.
            if len(entries) != 1:
                raise integration_error("PDF_ZIP_INVALID")
            entry = entries[0]
            name = entry.orig_filename
            if (
                not name.lower().endswith(".pdf")
                or "\x00" in name
                or "\\" in name
                or ":" in name
                or PurePosixPath(name).is_absolute()
                or any(part in {".", "..", ""} for part in name.split("/"))
                or entry.is_dir()
                or entry.flag_bits & 1
                or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG)
                or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                or entry.file_size > limit
                or entry.file_size > max(1, entry.compress_size) * 100
            ):
                raise integration_error("PDF_ZIP_INVALID")
            with archive.open(entry) as stream:
                result = stream.read(limit + 1)
            return validate_pdf(result, limit)
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, ValueError, OSError) as exc:
        raise integration_error("PDF_ZIP_INVALID") from exc


def webdav_path(locator: dict[str, object] | None) -> tuple[str, bool]:
    locator = locator or {}
    path = str(locator.get("path", ""))
    zipped = locator.get("kind") == "zotero_webdav"
    pattern = r"zotero/[A-Z0-9]{8}\.zip" if zipped else r"Logion/[a-f0-9]{64}\.pdf"
    if locator.get("kind") not in {"zotero_webdav", "logion_webdav"} or not re.fullmatch(
        pattern, path
    ):
        raise integration_error("PDF_LOCATOR_INVALID")
    return "/dav/" + path, zipped
