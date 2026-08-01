import base64
import binascii
from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
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
    worker_health_state_path: str = Field(
        default="/tmp/logion-worker-health.json",  # noqa: S108 - dedicated container tmpfs
        min_length=1,
        max_length=4096,
    )
    worker_health_stale_after_seconds: int = Field(default=15, ge=5, le=300)
    worker_health_failure_threshold: int = Field(default=3, ge=1, le=100)
    worker_health_dependency_timeout_seconds: int = Field(default=3, ge=1, le=15)
    secret_key: SecretStr = SecretStr("development-only-secret-key-change-me")
    cookie_secure: bool = False
    cookie_domain: str | None = None
    access_cookie_name: str = "logion_access"
    refresh_cookie_name: str = "logion_refresh"
    csrf_cookie_name: str = "logion_csrf"
    device_cookie_name: str = "logion_device"
    access_ttl_minutes: int = Field(default=15, ge=5, le=60)
    refresh_ttl_days: int = Field(default=30, ge=1, le=90)
    refresh_reuse_grace_seconds: int = Field(default=10, ge=1, le=30)
    require_origin_header: bool = True
    legacy_registration_enabled: bool = True
    registration_mode: Literal["open", "invite", "closed"] = "open"
    bootstrap_owner_email: EmailStr | None = None
    registration_limit_per_hour: int = Field(default=5, ge=1, le=100)
    email_registration_ip_limit_per_hour: int = Field(default=10, ge=1, le=100)
    email_registration_account_limit_per_hour: int = Field(default=3, ge=1, le=20)
    email_verification_confirm_limit_per_five_minutes: int = Field(default=30, ge=1, le=200)
    email_verification_ttl_hours: int = Field(default=24, ge=1, le=72)
    password_recovery_ip_limit_per_hour: int = Field(default=10, ge=1, le=100)
    password_recovery_account_limit_per_hour: int = Field(default=3, ge=1, le=20)
    password_recovery_complete_limit_per_five_minutes: int = Field(default=20, ge=1, le=100)
    password_recovery_ttl_minutes: int = Field(default=30, ge=10, le=60)
    password_recovery_max_failures: int = Field(default=5, ge=3, le=10)
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
    user_setting_write_limit_per_hour: int = Field(default=120, ge=1, le=2000)
    audit_query_limit_per_minute: int = Field(default=60, ge=1, le=600)
    sync_push_limit_per_minute: int = Field(default=120, ge=1, le=1000)
    sync_max_operation_bytes: int = Field(default=262144, ge=1024, le=1048576)
    sync_max_batch_bytes: int = Field(default=2097152, ge=1024, le=16777216)
    workspace_owned_quota: int = Field(default=10, ge=1, le=100)
    space_per_workspace_quota: int = Field(default=200, ge=1, le=10000)
    goal_per_space_quota: int = Field(default=500, ge=1, le=100000)
    planning_write_limit_per_hour: int = Field(default=120, ge=1, le=2000)
    task_per_goal_quota: int = Field(default=5000, ge=1, le=100000)
    execution_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    content_per_space_quota: int = Field(default=50000, ge=1, le=1000000)
    content_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    attachment_root: str = Field(default=".data/attachments", min_length=1, max_length=4096)
    attachment_max_bytes: int = Field(default=20 * 1024 * 1024, ge=1024, le=100 * 1024 * 1024)
    attachment_user_quota_bytes: int = Field(
        default=500 * 1024 * 1024, ge=1024, le=100 * 1024 * 1024 * 1024
    )
    attachment_write_limit_per_hour: int = Field(default=120, ge=1, le=5000)
    evidence_per_space_quota: int = Field(default=100000, ge=1, le=1000000)
    verification_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    topic_per_space_quota: int = Field(default=50000, ge=1, le=1000000)
    quiz_item_per_space_quota: int = Field(default=100000, ge=1, le=1000000)
    quiz_attempt_per_user_quota: int = Field(default=1000000, ge=1, le=10000000)
    audit_review_per_user_quota: int = Field(default=10000, ge=1, le=1000000)
    exam_per_user_quota: int = Field(default=1000, ge=1, le=100000)
    exam_subject_per_user_quota: int = Field(default=10000, ge=1, le=1000000)
    syllabus_node_per_user_quota: int = Field(default=100000, ge=1, le=1000000)
    mock_exam_per_user_quota: int = Field(default=10000, ge=1, le=1000000)
    score_record_per_user_quota: int = Field(default=100000, ge=1, le=1000000)
    self_study_entity_per_user_quota: int = Field(default=100000, ge=1, le=1000000)
    self_study_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    research_entity_per_user_quota: int = Field(default=100000, ge=1, le=1000000)
    research_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    collaboration_entity_per_space_quota: int = Field(default=100000, ge=1, le=1000000)
    collaboration_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
    ai_provider_per_workspace_quota: int = Field(default=50, ge=1, le=1000)
    ai_provider_write_limit_per_hour: int = Field(default=60, ge=1, le=1000)
    ai_provider_discovery_limit_per_hour: int = Field(default=10, ge=1, le=100)
    ai_provider_response_max_bytes: int = Field(default=1048576, ge=4096, le=4194304)
    ai_provider_discovery_model_limit: int = Field(default=1000, ge=1, le=5000)
    ai_run_write_limit_per_hour: int = Field(default=120, ge=1, le=2000)
    growth_write_limit_per_hour: int = Field(default=120, ge=1, le=2000)
    public_share_read_limit_per_minute: int = Field(default=120, ge=1, le=2000)
    search_limit_per_minute: int = Field(default=60, ge=1, le=1000)
    engagement_write_limit_per_hour: int = Field(default=240, ge=1, le=5000)
    public_calendar_read_limit_per_minute: int = Field(default=120, ge=1, le=2000)
    data_portability_write_limit_per_hour: int = Field(default=10, ge=1, le=100)
    account_deletion_grace_days: int = Field(default=14, ge=1, le=30)
    exam_write_limit_per_hour: int = Field(default=300, ge=1, le=10000)
    memory_write_limit_per_hour: int = Field(default=600, ge=1, le=10000)
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
    email_delivery_active_encryption_key_id: str = Field(
        default="development-v1",
        min_length=1,
        max_length=64,
    )
    email_delivery_encryption_keys: dict[str, SecretStr] = Field(
        default_factory=lambda: {
            "development-v1": SecretStr("ZGV2ZWxvcG1lbnQtZW1haWwta2V5LTMyYnl0ZXMhISE")
        }
    )
    email_delivery_provider: Literal["disabled", "aliyun_directmail"] = "disabled"
    email_public_base_url: str = Field(
        default="http://localhost:3000",
        min_length=8,
        max_length=2048,
    )
    email_delivery_max_attempts: int = Field(default=5, ge=1, le=10)
    email_delivery_lease_seconds: int = Field(default=120, ge=30, le=600)
    aliyun_directmail_region_id: str = Field(
        default="cn-hangzhou",
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9-]+$",
    )
    aliyun_directmail_endpoint: str | None = Field(default=None, max_length=253)
    aliyun_directmail_account_name: EmailStr | None = None
    aliyun_directmail_from_alias: str = Field(default="Logion", min_length=1, max_length=15)
    aliyun_directmail_ram_role_name: str | None = Field(default=None, max_length=64)
    aliyun_directmail_tag_name: str | None = Field(
        default=None,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
    )
    aliyun_directmail_connect_timeout_seconds: int = Field(default=5, ge=1, le=15)
    aliyun_directmail_read_timeout_seconds: int = Field(default=15, ge=5, le=60)
    ai_credential_active_encryption_key_id: str = Field(
        default="development-v1",
        min_length=1,
        max_length=64,
    )
    ai_credential_encryption_keys: dict[str, SecretStr] = Field(
        default_factory=lambda: {
            "development-v1": SecretStr("ZGV2ZWxvcG1lbnQtYWkta2V5LTMyYnl0ZXMhISEhISE")
        }
    )
    data_export_active_encryption_key_id: str = Field(
        default="development-v1", min_length=1, max_length=64
    )
    data_export_encryption_keys: dict[str, SecretStr] = Field(
        default_factory=lambda: {
            "development-v1": SecretStr("ZGV2ZWxvcG1lbnQtZXhwb3J0LWtleS0zMmJ5dGVzISE")
        }
    )

    @field_validator("bootstrap_owner_email", mode="before")
    @classmethod
    def normalize_empty_bootstrap_owner_email(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator(
        "aliyun_directmail_endpoint",
        "aliyun_directmail_account_name",
        "aliyun_directmail_ram_role_name",
        "aliyun_directmail_tag_name",
        mode="before",
    )
    @classmethod
    def normalize_empty_email_delivery_setting(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("email_public_base_url")
    @classmethod
    def normalize_email_public_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.params
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("LOGION_EMAIL_PUBLIC_BASE_URL must be an HTTP(S) origin only")
        return value.rstrip("/")

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
        if self.email_delivery_active_encryption_key_id not in self.email_delivery_encryption_keys:
            raise ValueError(
                "LOGION_EMAIL_DELIVERY_ACTIVE_ENCRYPTION_KEY_ID must select a configured key"
            )
        for key_id, encoded_key in self.email_delivery_encryption_keys.items():
            if not 1 <= len(key_id) <= 64:
                raise ValueError(
                    "LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS key IDs must be 1-64 characters"
                )
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
                    f"LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS contains invalid base64url for {key_id}"
                ) from exc
            if len(decoded_key) != 32:
                raise ValueError(
                    f"LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS key {key_id} must decode to 32 bytes"
                )
        if self.ai_credential_active_encryption_key_id not in self.ai_credential_encryption_keys:
            raise ValueError(
                "LOGION_AI_CREDENTIAL_ACTIVE_ENCRYPTION_KEY_ID must select a configured key"
            )
        for key_id, encoded_key in self.ai_credential_encryption_keys.items():
            if not 1 <= len(key_id) <= 64:
                raise ValueError(
                    "LOGION_AI_CREDENTIAL_ENCRYPTION_KEYS key IDs must be 1-64 characters"
                )
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
                    f"LOGION_AI_CREDENTIAL_ENCRYPTION_KEYS contains invalid base64url for {key_id}"
                ) from exc
            if len(decoded_key) != 32:
                raise ValueError(
                    f"LOGION_AI_CREDENTIAL_ENCRYPTION_KEYS key {key_id} must decode to 32 bytes"
                )
        if self.data_export_active_encryption_key_id not in self.data_export_encryption_keys:
            raise ValueError(
                "LOGION_DATA_EXPORT_ACTIVE_ENCRYPTION_KEY_ID must select a configured key"
            )
        for key_id, encoded_key in self.data_export_encryption_keys.items():
            if not 1 <= len(key_id) <= 64:
                raise ValueError(
                    "LOGION_DATA_EXPORT_ENCRYPTION_KEYS key IDs must be 1-64 characters"
                )
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
                    f"LOGION_DATA_EXPORT_ENCRYPTION_KEYS contains invalid base64url for {key_id}"
                ) from exc
            if len(decoded_key) != 32:
                raise ValueError(
                    f"LOGION_DATA_EXPORT_ENCRYPTION_KEYS key {key_id} must decode to 32 bytes"
                )
        if self.email_delivery_provider == "aliyun_directmail":
            minimum_safe_lease = (
                self.aliyun_directmail_connect_timeout_seconds
                + self.aliyun_directmail_read_timeout_seconds
                + 10
            )
            if self.email_delivery_lease_seconds < minimum_safe_lease:
                raise ValueError(
                    "LOGION_EMAIL_DELIVERY_LEASE_SECONDS must exceed DirectMail network timeouts"
                )
            if self.email_public_base_url not in {
                origin.rstrip("/") for origin in self.allowed_origins
            }:
                raise ValueError(
                    "LOGION_EMAIL_PUBLIC_BASE_URL must match an origin in LOGION_ALLOWED_ORIGINS"
                )
            if self.aliyun_directmail_account_name is None:
                raise ValueError(
                    "LOGION_ALIYUN_DIRECTMAIL_ACCOUNT_NAME is required for Aliyun DirectMail"
                )
            role_name = self.aliyun_directmail_ram_role_name or ""
            allowed_role_name_characters = (
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.@_-"
            )
            if not role_name or any(
                character not in allowed_role_name_characters for character in role_name
            ):
                raise ValueError(
                    "LOGION_ALIYUN_DIRECTMAIL_RAM_ROLE_NAME must name the attached ECS RAM role"
                )
            endpoint = self.aliyun_directmail_endpoint
            supported_directmail_regions = {
                "cn-hangzhou",
                "ap-southeast-1",
                "us-east-1",
                "eu-central-1",
            }
            if endpoint is None and self.aliyun_directmail_region_id not in (
                supported_directmail_regions
            ):
                raise ValueError("LOGION_ALIYUN_DIRECTMAIL_ENDPOINT is required for this region")
            if endpoint is not None:
                normalized_endpoint = endpoint.casefold().rstrip(".")
                supported_directmail_endpoints = {
                    "dm.aliyuncs.com",
                    "dm.ap-southeast-1.aliyuncs.com",
                    "dm.us-east-1.aliyuncs.com",
                    "dm.eu-central-1.aliyuncs.com",
                }
                if normalized_endpoint not in supported_directmail_endpoints:
                    raise ValueError(
                        "LOGION_ALIYUN_DIRECTMAIL_ENDPOINT must be an official aliyuncs.com DM host"
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
            if self.email_delivery_active_encryption_key_id.startswith("development-"):
                raise ValueError(
                    "LOGION_EMAIL_DELIVERY_ENCRYPTION_KEYS must be replaced in production"
                )
            if self.email_delivery_provider != "aliyun_directmail":
                raise ValueError(
                    "LOGION_EMAIL_DELIVERY_PROVIDER must enable a production delivery provider"
                )
            if not self.email_public_base_url.startswith("https://"):
                raise ValueError("LOGION_EMAIL_PUBLIC_BASE_URL must use HTTPS in production")
            if self.ai_credential_active_encryption_key_id.startswith("development-"):
                raise ValueError(
                    "LOGION_AI_CREDENTIAL_ENCRYPTION_KEYS must be replaced in production"
                )
            if self.data_export_active_encryption_key_id.startswith("development-"):
                raise ValueError(
                    "LOGION_DATA_EXPORT_ENCRYPTION_KEYS must be replaced in production"
                )
            if self.legacy_registration_enabled:
                raise ValueError(
                    "LOGION_LEGACY_REGISTRATION_ENABLED must be disabled in production"
                )
            if self.registration_mode == "open":
                raise ValueError(
                    "LOGION_REGISTRATION_MODE must be 'invite' or 'closed' in production"
                )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
