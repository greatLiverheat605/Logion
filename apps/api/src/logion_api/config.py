from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded only from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="LOGION_",
        extra="ignore",
    )

    env: str = "development"
    version: str = "0.1.0"
    log_level: str = "INFO"
    database_url: str = "postgresql+asyncpg://logion:change-me@localhost:5432/logion"
    redis_url: str = "redis://localhost:6379/0"
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    healthcheck_dependencies: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
