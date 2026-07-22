FROM ghcr.io/astral-sh/uv:0.11.29 AS uv
FROM python:3.12.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/worker/pyproject.toml apps/worker/pyproject.toml
RUN uv sync --frozen --no-dev --package logion-worker --no-install-workspace

COPY apps/api apps/api
COPY apps/worker apps/worker
RUN uv sync --frozen --no-dev --package logion-worker

RUN useradd --create-home --uid 10001 logion
USER 10001

ENV PATH="/app/.venv/bin:$PATH"
CMD ["python", "-m", "logion_worker.main"]
