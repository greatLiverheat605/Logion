import base64
import binascii
from functools import lru_cache
from urllib.parse import urlparse

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
    login_ip_limit_per_five_minutes: int = Field(default=30, ge=1, le=300)
    login_account_limit_per_five_minutes: int = Field(default=10, ge=1, le=100)
    passkey_limit_per_five_minutes: int = Field(default=20, ge=1, le=200)
    totp_limit_per_five_minutes: int = Field(default=10, ge=1, le=100)
    passkey_max_credentials: int = Field(default=20, ge=1, le=100)
    recent_auth_ttl_seconds: int = Field(default=600, ge=60, le=1800)
    webauthn_rp_id: str = Field(default="localhost", min_length=1, max_length=253)
    webauthn_rp_name: str = Field(default="Logion", min_length=1, max_length=80)
    webauthn_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    webauthn_challenge_ttl_seconds: int = Field(default=300, ge=60, le=600)
    totp_issuer_name: str = Field(default="Logion", min_length=1, max_length=80)
    totp_challenge_ttl_seconds: int = Field(default=300, ge=60, le=600)
    totp_enrollment_ttl_seconds: int = Field(default=600, ge=300, le=1800)
    workspace_create_limit_per_hour: int = Field(default=10, ge=1, le=100)
    space_create_limit_per_hour: int = Field(default=60, ge=1, le=1000)
    invitation_create_limit_per_hour: int = Field(default=30, ge=1, le=500)
    invitation_accept_limit_per_five_minutes: int = Field(default=20, ge=1, le=200)
    invitation_ttl_days: int = Field(default=7, ge=1, le=30)
    membership_change_limit_per_hour: int = Field(default=60, ge=1, le=1000)
    ownership_transfer_limit_per_hour: int = Field(default=10, ge=1, le=100)
    membership_leave_limit_per_hour: int = Field(default=10, ge=1, le=100)
    audit_query_limit_per_minute: int = Field(default=60, ge=1, le=600)
    workspace_owned_quota: int = Field(default=10, ge=1, le=100)
    space_per_workspace_quota: int = Field(default=200, ge=1, le=10000)
    totp_active_encryption_key_id: str = Field(
        default="development-v1",
        min_length=1,
        max_length=64,
    )
    totp_encryption_keys: dict[str, SecretStr] = Field(
        default_factory=lambda: {
            "development-v1": SecretStr("ZGV2ZWxvcG1lbnQtb25seS10b3RwLWtleS0zMmJ5dGU")
        }
    )

    @model_validator(mode="after")
    def validate_security_configuration(self) -> "Settings":
        secret = self.secret_key.get_secret_value()
        if len(secret) < 32:
            raise ValueError("LOGION_SECRET_KEY must contain at least 32 characters")
        if self.totp_active_encryption_key_id not in self.totp_encryption_keys:
            raise ValueError("LOGION_TOTP_ACTIVE_ENCRYPTION_KEY_ID must select a configured key")
        for key_id, encoded_key in self.totp_encryption_keys.items():
            if not 1 <= len(key_id) <= 64:
                raise ValueError("LOGION_TOTP_ENCRYPTION_KEYS key IDs must be 1-64 characters")
            try:
                value = encoded_key.get_secret_value()
                padding = "=" * (-len(value) % 4)
                decoded_key = base64.b64decode(
                    value + padding,
                    altchars=b"-_",
                    validate=True,
                )
            except (binascii.Error, ValueError) as exc:
                raise ValueError(
                    f"LOGION_TOTP_ENCRYPTION_KEYS contains invalid base64url for {key_id}"
                ) from exc
            if len(decoded_key) != 32:
                raise ValueError(
                    f"LOGION_TOTP_ENCRYPTION_KEYS key {key_id} must decode to 32 bytes"
                )
        if not set(self.webauthn_origins).issubset(self.allowed_origins):
            raise ValueError("LOGION_WEBAUTHN_ORIGINS must be included in LOGION_ALLOWED_ORIGINS")
        for origin in self.webauthn_origins:
            parsed = urlparse(origin)
            hostname = parsed.hostname or ""
            if (
                parsed.scheme not in {"http", "https"}
                or not hostname
                or parsed.path not in {"", "/"}
                or parsed.params
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("LOGION_WEBAUTHN_ORIGINS must contain valid origins only")
            if hostname != self.webauthn_rp_id and not hostname.endswith(f".{self.webauthn_rp_id}"):
                raise ValueError("LOGION_WEBAUTHN_RP_ID must match every WebAuthn origin")
        if self.env == "production":
            if secret.startswith("development-only"):
                raise ValueError("LOGION_SECRET_KEY must be replaced in production")
            if not self.cookie_secure:
                raise ValueError("LOGION_COOKIE_SECURE must be enabled in production")
            if not self.require_origin_header:
                raise ValueError("LOGION_REQUIRE_ORIGIN_HEADER must be enabled in production")
            if any(not origin.startswith("https://") for origin in self.allowed_origins):
                raise ValueError("LOGION_ALLOWED_ORIGINS must use HTTPS in production")
            if self.webauthn_rp_id == "localhost":
                raise ValueError("LOGION_WEBAUTHN_RP_ID must be configured in production")
            if self.totp_active_encryption_key_id.startswith("development-"):
                raise ValueError("LOGION_TOTP_ENCRYPTION_KEYS must be replaced in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
