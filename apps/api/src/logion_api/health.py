import asyncio
from collections.abc import Awaitable
from typing import Literal, cast

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from logion_api.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "ready"]
    service: Literal["api"] = "api"
    version: str
    checks: dict[str, Literal["ok"]] | None = None


@router.get("/live", response_model=HealthResponse, operation_id="health_live")
async def live() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", version=settings.version)


@router.get("/ready", response_model=HealthResponse, operation_id="health_ready")
async def ready() -> HealthResponse:
    settings = get_settings()
    checks: dict[str, Literal["ok"]] = {"application": "ok"}
    if settings.healthcheck_dependencies:
        try:
            async with asyncio.timeout(3):
                engine = create_async_engine(settings.database_url, pool_pre_ping=True)
                try:
                    async with engine.connect() as connection:
                        await connection.execute(text("SELECT 1"))
                finally:
                    await engine.dispose()

                redis = Redis.from_url(settings.redis_url)
                try:
                    await cast(Awaitable[bool], redis.ping())
                finally:
                    await redis.aclose()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="A required service is unavailable.",
            ) from exc
        checks.update({"database": "ok", "redis": "ok"})

    return HealthResponse(status="ready", version=settings.version, checks=checks)
