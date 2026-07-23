FROM ghcr.io/astral-sh/uv:0.11.29 AS uv
FROM python:3.12.13-alpine3.24 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=uv /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/worker/pyproject.toml apps/worker/pyproject.toml
RUN uv sync --frozen --no-dev --package logion-api --no-install-workspace

COPY apps/api apps/api
RUN uv sync --frozen --no-dev --package logion-api

RUN addgroup -S -g 10001 logion \
    && adduser -S -D -H -u 10001 -G logion logion
USER 10001

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "logion_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
