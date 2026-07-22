from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from uuid6 import uuid7

from logion_api.db import Base, utc_now


class DataExportJob(Base):
    __tablename__ = "data_export_jobs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('queued','running','succeeded','failed','cancelled','expired')",
            name="ck_data_export_job_status",
        ),
        Index("ix_data_export_job_queue", "status", "created_at"),
        Index("ix_data_export_job_owner", "workspace_id", "requested_by", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    workspace_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    requested_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[Literal["queued", "running", "succeeded", "failed", "cancelled", "expired"]] = (
        mapped_column(String(16), nullable=False, default="queued")
    )
    schema_version: Mapped[str] = mapped_column(
        String(32), nullable=False, default="logion-export-v1"
    )
    artifact_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    artifact_nonce: Mapped[bytes | None] = mapped_column(LargeBinary)
    artifact_encryption_key_id: Mapped[str | None] = mapped_column(String(64))
    artifact_sha256: Mapped[str | None] = mapped_column(String(64))
    artifact_bytes: Mapped[int | None] = mapped_column(BigInteger)
    error_code: Mapped[str | None] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
