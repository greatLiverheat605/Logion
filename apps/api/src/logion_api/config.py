from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
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
    secret_key: SecretStr = SecretStr("development-only-secret-key-change-me")
    cookie_secure: bool = False
    cookie_domain: str | None = None
    access_cookie_name: str = "logion_access"
    refresh_cookie_name: str = "logion_refresh"
    csrf_cookie_name: str = "logion_csrf"
    device_cookie_name: str = "logion_device"
    access_ttl_minutes: int = Field(default=15, ge=5, le=60)
    refresh_ttl_days: int = Field(default=30, ge=1, le=90)
    require_origin_header: bool = True
    registration_limit_per_hour: int = Field(default=5, ge=1, le=100)
    login_limit_per_five_minutes: int = Field(default=10, ge=1, le=100)

    @model_validator(mode="after")
    def reject_development_secrets_in_production(self) -> "Settings":
        secret = self.secret_key.get_secret_value()
        if len(secret) < 32:
            raise ValueError("LOGION_SECRET_KEY must contain at least 32 characters")
        if self.env == "production":
            if secret.startswith("development-only"):
                raise ValueError("LOGION_SECRET_KEY must be replaced in production")
            if not self.cookie_secure:
                raise ValueError("LOGION_COOKIE_SECURE must be enabled in production")
            if not self.require_origin_header:
                raise ValueError("LOGION_REQUIRE_ORIGIN_HEADER must be enabled in production")
            if any(not origin.startswith("https://") for origin in self.allowed_origins):
                raise ValueError("LOGION_ALLOWED_ORIGINS must use HTTPS in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
