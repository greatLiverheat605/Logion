from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("workflow", "full_stack_command"),
    [
        (
            ".github/workflows/main.yml",
            "docker compose up --no-build --wait --timeout 180 web api worker reverse-proxy",
        ),
        (
            ".github/workflows/release.yml",
            "docker compose up --no-build --wait --timeout 180\n",
        ),
    ],
)
def test_candidate_database_is_migrated_before_worker_readiness(
    workflow: str,
    full_stack_command: str,
) -> None:
    source = (ROOT / workflow).read_text(encoding="utf-8")

    dependencies = source.index(
        "docker compose up --no-build --wait --timeout 180 postgres redis"
    )
    migration = source.index(
        "docker compose run --no-deps --rm api \\\n"
        "            alembic -c apps/api/alembic.ini upgrade head",
        dependencies,
    )
    full_stack = source.index(full_stack_command, migration)

    assert dependencies < migration < full_stack


@pytest.mark.parametrize(
    ("workflow", "compose_step", "next_step"),
    [
        (
            ".github/workflows/release.yml",
            "      - name: Pull and smoke the unchanged candidate",
            "      - name: Empty-environment recovery rehearsal",
        ),
        (
            ".github/workflows/nightly.yml",
            "      - name: Compose smoke",
            "      - name: Migration and empty-environment restore",
        ),
    ],
)
def test_authenticated_browser_origin_is_trusted_by_compose_api(
    workflow: str,
    compose_step: str,
    next_step: str,
) -> None:
    source = (ROOT / workflow).read_text(encoding="utf-8")
    start = source.index(compose_step)
    end = source.index(next_step, start)

    assert (
        "LOGION_ALLOWED_ORIGINS: "
        "'[\"http://localhost:3000\",\"http://127.0.0.1:8080\"]'"
        in source[start:end]
    )
    assert "LOGION_E2E_BASE_URL: http://127.0.0.1:8080" in source[end:]
