from datetime import date, datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class AIProvider(Base):
    __tablename__ = "ai_providers"
    __table_args__ = (
        CheckConstraint(
            "provider_type = 'openai_compatible'", name="ck_ai_provider_supported_type"
        ),
        CheckConstraint("timeout_seconds BETWEEN 1 AND 300", name="ck_ai_provider_timeout"),
        CheckConstraint("max_retries BETWEEN 0 AND 5", name="ck_ai_provider_retries"),
        CheckConstraint(
            "last_health_status IN ('unknown', 'healthy', 'unhealthy')",
            name="ck_ai_provider_health_status",
        ),
        Index(
            "uq_ai_provider_active_name",
            "workspace_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_ai_provider_workspace_updated", "workspace_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(240), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(32), nullable=False)
    base_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    credential_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    credential_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    data_key_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    data_key_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    encryption_key_id: Mapped[str | None] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    last_health_status: Mapped[Literal["unknown", "healthy", "unhealthy"]] = mapped_column(
        String(16), nullable=False, default="unknown"
    )
    last_health_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_health_error_code: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIModel(Base):
    __tablename__ = "ai_models"
    __table_args__ = (
        CheckConstraint("source IN ('discovered', 'manual')", name="ck_ai_model_source"),
        CheckConstraint(
            "context_window IS NULL OR context_window > 0", name="ck_ai_model_context_window"
        ),
        CheckConstraint(
            "input_cost_per_million_minor >= 0 AND output_cost_per_million_minor >= 0",
            name="ck_ai_model_pricing_nonnegative",
        ),
        Index(
            "uq_ai_model_active_provider_id",
            "workspace_id",
            "provider_id",
            "provider_model_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index("ix_ai_model_workspace_provider", "workspace_id", "provider_id", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    provider_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_providers.id", ondelete="CASCADE"), nullable=False
    )
    provider_model_id: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[Literal["discovered", "manual"]] = mapped_column(
        String(16), nullable=False, default="discovered"
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_json: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_stream: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    context_window: Mapped[int | None] = mapped_column(Integer)
    pricing_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    input_cost_per_million_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    output_cost_per_million_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0
    )
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIWorkspaceBudget(Base):
    __tablename__ = "ai_workspace_budgets"
    __table_args__ = (
        CheckConstraint(
            "monthly_token_budget IS NULL OR monthly_token_budget > 0",
            name="ck_ai_budget_tokens_positive",
        ),
        CheckConstraint(
            "monthly_cost_budget_minor IS NULL OR monthly_cost_budget_minor > 0",
            name="ck_ai_budget_cost_positive",
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    monthly_token_budget: Mapped[int | None] = mapped_column(BigInteger)
    monthly_cost_budget_minor: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class AITaskRoute(Base):
    __tablename__ = "ai_task_routes"
    __table_args__ = (
        CheckConstraint("max_input_tokens > 0", name="ck_ai_route_input_positive"),
        CheckConstraint("max_output_tokens > 0", name="ck_ai_route_output_positive"),
        Index(
            "uq_ai_route_active_name",
            "workspace_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        Index(
            "uq_ai_route_active_task_type",
            "workspace_id",
            "task_type",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND enabled"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(240), nullable=False)
    task_type: Mapped[str] = mapped_column(String(64), nullable=False)
    requires_json: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    requires_stream: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AITaskRouteTarget(Base):
    __tablename__ = "ai_task_route_targets"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_ai_route_target_position"),
        UniqueConstraint("route_id", "position", name="uq_ai_route_target_position"),
        UniqueConstraint("route_id", "model_id", name="uq_ai_route_target_model"),
        Index("ix_ai_route_target_workspace_route", "workspace_id", "route_id", "position"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    route_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_task_routes.id", ondelete="CASCADE"), nullable=False
    )
    model_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_models.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class AIUsageMonthly(Base):
    __tablename__ = "ai_usage_monthly"
    __table_args__ = (
        CheckConstraint(
            "reserved_tokens >= 0 AND consumed_tokens >= 0 AND reserved_cost_minor >= 0 "
            "AND consumed_cost_minor >= 0",
            name="ck_ai_usage_nonnegative",
        ),
    )

    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    reserved_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    consumed_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    reserved_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    consumed_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class AIRun(Base):
    __tablename__ = "ai_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed','cancelled')",
            name="ck_ai_run_status",
        ),
        CheckConstraint("target_version > 0", name="ck_ai_run_target_version"),
        CheckConstraint(
            "estimated_input_tokens > 0 AND requested_output_tokens > 0 "
            "AND reserved_tokens > 0 AND reserved_cost_minor >= 0",
            name="ck_ai_run_estimates",
        ),
        UniqueConstraint(
            "workspace_id", "requested_by", "idempotency_key", name="uq_ai_run_idempotency"
        ),
        Index("ix_ai_run_workspace_created", "workspace_id", "created_at"),
        Index(
            "ix_ai_run_queue",
            "status",
            "created_at",
            postgresql_where=text("status = 'queued'"),
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    route_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_task_routes.id", ondelete="RESTRICT"), nullable=False
    )
    task_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    target_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    selected_fields: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    expected_output_fields: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    input_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    input_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    input_data_key_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    input_data_key_nonce: Mapped[bytes | None] = mapped_column(LargeBinary(12))
    input_encryption_key_id: Mapped[str | None] = mapped_column(String(64))
    retain_input: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[Literal["queued", "running", "succeeded", "failed", "cancelled"]] = (
        mapped_column(String(16), nullable=False, default="queued")
    )
    estimated_input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    requested_output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    reserved_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reserved_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    actual_input_tokens: Mapped[int | None] = mapped_column(BigInteger)
    actual_output_tokens: Mapped[int | None] = mapped_column(BigInteger)
    actual_cost_minor: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    selected_model_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("ai_models.id", ondelete="RESTRICT")
    )
    selected_provider_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("ai_providers.id", ondelete="RESTRICT")
    )
    selected_candidate_position: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(64))
    cancel_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requested_by: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="RESTRICT"))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AIRunCandidate(Base):
    __tablename__ = "ai_run_candidates"
    __table_args__ = (
        CheckConstraint("position >= 0", name="ck_ai_run_candidate_position"),
        UniqueConstraint("run_id", "position", name="uq_ai_run_candidate_position"),
        UniqueConstraint("run_id", "model_id", name="uq_ai_run_candidate_model"),
        Index("ix_ai_run_candidate_run", "workspace_id", "run_id", "position"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False
    )
    model_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_models.id", ondelete="RESTRICT"), nullable=False
    )
    provider_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_providers.id", ondelete="RESTRICT"), nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class AIOutputDraft(Base):
    __tablename__ = "ai_output_drafts"
    __table_args__ = (
        CheckConstraint("status IN ('pending','accepted','rejected')", name="ck_ai_draft_status"),
        Index("ix_ai_draft_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    run_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("ai_runs.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    target_type: Mapped[str] = mapped_column(String(64), nullable=False)
    target_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    target_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    structured_output: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    edited_output: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    status: Mapped[Literal["pending", "accepted", "rejected"]] = mapped_column(
        String(16), nullable=False, default="pending"
    )
    decided_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT")
    )
    decision_note: Mapped[str | None] = mapped_column(String(1000))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
