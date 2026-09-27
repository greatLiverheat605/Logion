"""Every LOGION_* key documented in .env.example must reach a container or be
excluded here with a reason; otherwise a deployer's setting is silently ignored."""

import re
from pathlib import Path

from logion_api.config import Settings

ROOT = Path(__file__).resolve().parents[1]

# Deliberately not forwarded by compose.yaml. Enabling any of these needs an
# additional reviewed overlay, not just a value in .env.
EXCLUDED = {
    "LOGION_API_HOST": "Not a settings field; the API image listens on 0.0.0.0:8000.",
    "LOGION_API_PORT": "Not a settings field; health checks and nginx use port 8000.",
    **{
        key: "Scanner overlay required: clamd service, network and quarantine volume "
        "(infra/runbooks/attachment-scanner.md)."
        for key in (
            "LOGION_ATTACHMENT_QUARANTINE_ROOT",
            "LOGION_ATTACHMENT_SCANNER_ENABLED",
            "LOGION_ATTACHMENT_SCANNER_HOST",
            "LOGION_ATTACHMENT_SCANNER_PORT",
            "LOGION_ATTACHMENT_SCANNER_TIMEOUT_SECONDS",
            "LOGION_ATTACHMENT_SCANNER_CHUNK_BYTES",
        )
    },
    **{
        key: "Knowledge Space is a sensitive capability that needs cursor secrets and "
        "separate owner approval; it stays off in the default stack."
        for key in (
            "LOGION_KNOWLEDGE_SPACE_API_ENABLED",
            "LOGION_KNOWLEDGE_SPACE_SHARED_WRITES_ENABLED",
            "LOGION_KNOWLEDGE_SPACE_AI_ACCEPTANCE_ENABLED",
            "LOGION_KNOWLEDGE_SPACE_DELETION_ENABLED",
            "LOGION_KNOWLEDGE_SPACE_ATTACHMENT_INGEST_ENABLED",
            "LOGION_KNOWLEDGE_SPACE_LOCAL_WORKER_ENABLED",
            "LOGION_LOCAL_WORKER_WRITE_LIMIT_PER_HOUR",
            "LOGION_LOCAL_WORKER_LEASE_SECONDS",
            "LOGION_KNOWLEDGE_CURSOR_ACTIVE_KEY_ID",
            "LOGION_KNOWLEDGE_CURSOR_KEYS",
            "LOGION_KNOWLEDGE_CURSOR_TTL_SECONDS",
            "LOGION_KNOWLEDGE_CURSOR_CLOCK_SKEW_SECONDS",
        )
    },
}
# Compose defaults that intentionally differ from the application defaults.
HARDENED = {
    "LOGION_REGISTRATION_MODE": "Self-hosted stacks default to invite-only registration.",
    "LOGION_VERSION": "The web service leaves it empty so the build reports its own version.",
}
DEFAULT = re.compile(r"(LOGION_[A-Z0-9_]+): \$\{\1:-([^}]*)\}")


def example_keys() -> set[str]:
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    return set(re.findall(r"^(LOGION_[A-Z0-9_]+)=", text, re.MULTILINE))


def compose_text() -> str:
    return (ROOT / "compose.yaml").read_text(encoding="utf-8")


def test_every_documented_key_is_forwarded_or_explicitly_excluded() -> None:
    referenced = set(re.findall(r"LOGION_[A-Z0-9_]+", compose_text()))
    missing = sorted(example_keys() - referenced - EXCLUDED.keys())
    assert missing == [], f"forward in compose.yaml or add to EXCLUDED with a reason: {missing}"


def test_excluded_keys_are_documented_and_really_not_forwarded() -> None:
    referenced = set(re.findall(r"LOGION_[A-Z0-9_]+", compose_text()))
    assert EXCLUDED.keys() <= example_keys()
    assert sorted(EXCLUDED.keys() & referenced) == []


def test_compose_defaults_match_application_defaults() -> None:
    fields = Settings.model_fields
    checked = 0
    for key, default in DEFAULT.findall(compose_text()):
        name = key.removeprefix("LOGION_").lower()
        field = fields.get(name)
        if field is None or field.default_factory is not None:
            continue
        expected = field.default
        if key in HARDENED or isinstance(expected, (list, dict)):
            continue
        if expected is None:
            assert default == "", key
        elif isinstance(expected, bool):
            assert default == str(expected).lower(), key
        else:
            assert default == str(expected), key
        checked += 1
    assert checked >= 30
