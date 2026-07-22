from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'suspended', 'pending_deletion', 'deleted')",
            name="ck_users_status",
        ),
        Index("ix_users_email_normalized", "email_normalized", unique=True),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    email_normalized: Mapped[str] = mapped_column(String(320), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    password_credential: Mapped["PasswordCredential | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )


class PasswordCredential(Base):
    __tablename__ = "password_credentials"

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    params_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="password_credential")


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (Index("ix_devices_user_last_seen", "user_id", "last_seen_at"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False, default="web")
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    user_agent_hash: Mapped[str | None] = mapped_column(String(64))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        Index("ix_auth_sessions_user_active", "user_id", "revoked_at"),
        Index("ix_auth_sessions_device_active", "device_id", "revoked_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    access_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    rotation_counter: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    access_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    refresh_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(64))


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'rotated', 'revoked')",
            name="ck_refresh_tokens_status",
        ),
        Index("ix_refresh_tokens_session_status", "session_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    session_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("auth_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("refresh_tokens.id", ondelete="SET NULL"),
    )


class PasskeyCredential(Base):
    __tablename__ = "passkey_credentials"
    __table_args__ = (
        CheckConstraint(
            "credential_device_type IN ('single_device', 'multi_device')",
            name="ck_passkey_credentials_device_type",
        ),
        Index("ix_passkey_credentials_user_active", "user_id", "revoked_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    credential_id: Mapped[bytes] = mapped_column(LargeBinary(1024), nullable=False, unique=True)
    public_key: Mapped[bytes] = mapped_column(LargeBinary(4096), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    aaguid: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    transports: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    credential_device_type: Mapped[str] = mapped_column(String(32), nullable=False)
    backed_up: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebAuthnChallenge(Base):
    __tablename__ = "webauthn_challenges"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('registration', 'authentication')",
            name="ck_webauthn_challenges_purpose",
        ),
        Index("ix_webauthn_challenges_expiry", "expires_at", "used_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    challenge: Mapped[bytes] = mapped_column(LargeBinary(128), nullable=False)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TotpCredential(Base):
    __tablename__ = "totp_credentials"
    __table_args__ = (
        CheckConstraint("algorithm = 'SHA1'", name="ck_totp_credentials_algorithm"),
        CheckConstraint("digits = 6", name="ck_totp_credentials_digits"),
        CheckConstraint("period = 30", name="ck_totp_credentials_period"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    secret_ciphertext: Mapped[bytes] = mapped_column(LargeBinary(256), nullable=False)
    secret_nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    data_key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary(64), nullable=False)
    data_key_nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    encryption_key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    algorithm: Mapped[str] = mapped_column(String(16), nullable=False, default="SHA1")
    digits: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=6)
    period: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=30)
    last_used_step: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    pending_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RecoveryCode(Base):
    __tablename__ = "recovery_codes"
    __table_args__ = (Index("ix_recovery_codes_user_active", "user_id", "used_at", "revoked_at"),)

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    batch_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    lookup_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MfaChallenge(Base):
    __tablename__ = "mfa_challenges"
    __table_args__ = (
        CheckConstraint("purpose = 'login'", name="ck_mfa_challenges_purpose"),
        Index("ix_mfa_challenges_expiry", "expires_at", "used_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(16), nullable=False, default="login")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    device_name: Mapped[str] = mapped_column(String(80), nullable=False)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    user_agent_hash: Mapped[str | None] = mapped_column(String(64))
    failed_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IdentityActionToken(Base):
    __tablename__ = "identity_action_tokens"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('email_verification', 'password_recovery')",
            name="ck_identity_action_tokens_purpose",
        ),
        Index(
            "ix_identity_action_tokens_user_purpose_active",
            "user_id",
            "purpose",
            "used_at",
            "revoked_at",
        ),
        Index("ix_identity_action_tokens_expiry", "purpose", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    failed_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class EmailOutbox(Base):
    __tablename__ = "email_outbox"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('email_verification', 'password_recovery', 'security_notification')",
            name="ck_email_outbox_purpose",
        ),
        CheckConstraint(
            "status IN ('pending', 'leased', 'sent', 'failed', 'dead')",
            name="ck_email_outbox_status",
        ),
        Index("ix_email_outbox_delivery", "status", "available_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    action_token_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("identity_action_tokens.id", ondelete="SET NULL"),
        index=True,
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    encryption_key_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_ciphertext: Mapped[bytes] = mapped_column(LargeBinary(4096), nullable=False)
    payload_nonce: Mapped[bytes] = mapped_column(LargeBinary(12), nullable=False)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    terminal_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_actor_time", "actor_id", "occurred_at"),
        Index("ix_audit_events_actor_time_id", "actor_id", "occurred_at", "id"),
        Index("ix_audit_events_workspace_time_id", "workspace_id", "occurred_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    actor_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    request_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[UUID | None] = mapped_column(Uuid)
    result: Mapped[str] = mapped_column(String(32), nullable=False)
    event_metadata: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
