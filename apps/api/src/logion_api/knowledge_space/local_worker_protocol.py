"""Isolated server-side Local Worker protocol candidate.

This module intentionally has no FastAPI route, database dependency, session
dependency, provider client, or feature-flag integration. It models the
fail-closed lease/checkpoint/result contract so the service semantics can be
reviewed before a production API is authorized.
"""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Final, Literal
from uuid import UUID, uuid4

LeaseState = Literal["active", "revoked", "expired", "completed"]
CheckpointStage = Literal["claimed", "running", "uploaded"]
_STAGE_ORDER: Final[dict[CheckpointStage, int]] = {
    "claimed": 0,
    "running": 1,
    "uploaded": 2,
}
MAX_CHECKPOINT_BYTES: Final[int] = 16 * 1024
MAX_IDEMPOTENCY_KEY_BYTES: Final[int] = 128


class LocalWorkerProtocolError(ValueError):
    """A protocol operation failed closed."""


@dataclass(frozen=True)
class ServerLease:
    lease_id: UUID
    job_id: UUID
    workspace_id: UUID
    space_id: UUID
    input_sha256: str
    issued_at: datetime
    expires_at: datetime
    token_digest: str
    state: LeaseState = "active"


@dataclass(frozen=True)
class ServerCheckpoint:
    job_id: UUID
    lease_id: UUID
    workspace_id: UUID
    space_id: UUID
    input_sha256: str
    stage: CheckpointStage
    output_sha256: str | None
    updated_at: datetime


@dataclass(frozen=True)
class ResultReceipt:
    job_id: UUID
    lease_id: UUID
    idempotency_key: str
    output_sha256: str
    accepted_at: datetime


class LocalWorkerProtocol:
    """Model the server authority for a future Local Worker integration."""

    def __init__(
        self,
        *,
        lease_seconds: int = 120,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not 30 <= lease_seconds <= 600:
            raise LocalWorkerProtocolError("lease duration must be between 30 and 600 seconds")
        self._lease_seconds = lease_seconds
        self._clock = clock or (lambda: datetime.now(UTC))
        self._leases: dict[UUID, ServerLease] = {}
        self._checkpoints: dict[UUID, ServerCheckpoint] = {}
        self._receipts: dict[str, ResultReceipt] = {}

    def issue_lease(
        self,
        *,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        now: datetime | None = None,
    ) -> tuple[ServerLease, str]:
        self._validate_hash(input_sha256)
        issued_at = self._utc(now)
        token = secrets.token_urlsafe(32)
        claims = ServerLease(
            lease_id=uuid4(),
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256=input_sha256,
            issued_at=issued_at,
            expires_at=issued_at + timedelta(seconds=self._lease_seconds),
            token_digest=self._digest(token),
        )
        self._leases[claims.lease_id] = claims
        return claims, token

    def revoke(self, lease_id: UUID) -> ServerLease:
        claims = self._leases.get(lease_id)
        if claims is None:
            raise LocalWorkerProtocolError("worker lease is unknown")
        if claims.state == "active":
            claims = replace(claims, state="revoked")
            self._leases[lease_id] = claims
        return claims

    def checkpoint(
        self,
        *,
        lease_id: UUID,
        token: str,
        stage: CheckpointStage,
        output_sha256: str | None = None,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        now: datetime | None = None,
    ) -> ServerCheckpoint:
        claims = self.validate_lease(
            lease_id=lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256=input_sha256,
            now=now,
        )
        if stage not in _STAGE_ORDER:
            raise LocalWorkerProtocolError("checkpoint stage is invalid")
        if output_sha256 is not None:
            self._validate_hash(output_sha256)
        previous = self._checkpoints.get(job_id)
        if previous is not None and _STAGE_ORDER[stage] < _STAGE_ORDER[previous.stage]:
            raise LocalWorkerProtocolError("checkpoint stage cannot move backwards")
        if stage == "uploaded" and output_sha256 is None:
            raise LocalWorkerProtocolError("uploaded checkpoint requires an output hash")
        checkpoint = ServerCheckpoint(
            job_id=claims.job_id,
            lease_id=claims.lease_id,
            workspace_id=claims.workspace_id,
            space_id=claims.space_id,
            input_sha256=claims.input_sha256,
            stage=stage,
            output_sha256=output_sha256,
            updated_at=self._utc(now),
        )
        if len(repr(checkpoint).encode("utf-8")) > MAX_CHECKPOINT_BYTES:
            raise LocalWorkerProtocolError("worker checkpoint exceeds size limit")
        self._checkpoints[job_id] = checkpoint
        return checkpoint

    def submit_result(
        self,
        *,
        lease_id: UUID,
        token: str,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        idempotency_key: str,
        output_sha256: str,
        now: datetime | None = None,
    ) -> ResultReceipt:
        self._validate_idempotency_key(idempotency_key)
        self._validate_hash(output_sha256)
        claims = self._validate_result_lease(
            lease_id=lease_id,
            token=token,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256=input_sha256,
            now=now,
        )
        payload_digest = self._result_digest(job_id, input_sha256, output_sha256)
        previous = self._receipts.get(idempotency_key)
        if previous is not None:
            if (
                self._result_digest(previous.job_id, input_sha256, previous.output_sha256)
                != payload_digest
            ):
                raise LocalWorkerProtocolError(
                    "result idempotency key conflicts with a different payload"
                )
            return previous
        checkpoint = self._checkpoints.get(job_id)
        if (
            checkpoint is None
            or checkpoint.stage != "uploaded"
            or checkpoint.output_sha256 != output_sha256
        ):
            raise LocalWorkerProtocolError("result is not backed by an uploaded checkpoint")
        receipt = ResultReceipt(
            job_id=claims.job_id,
            lease_id=claims.lease_id,
            idempotency_key=idempotency_key,
            output_sha256=output_sha256,
            accepted_at=self._utc(now),
        )
        self._receipts[idempotency_key] = receipt
        self._checkpoints.pop(job_id, None)
        self._leases[lease_id] = replace(claims, state="completed")
        return receipt

    def recovery(self, job_id: UUID) -> ServerCheckpoint | None:
        """Return only bounded checkpoint metadata; never raw worker payloads."""

        return self._checkpoints.get(job_id)

    def validate_lease(
        self,
        *,
        lease_id: UUID,
        token: str,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        now: datetime | None = None,
    ) -> ServerLease:
        self._validate_hash(input_sha256)
        claims = self._leases.get(lease_id)
        current = self._utc(now)
        if claims is None or claims.state != "active":
            raise LocalWorkerProtocolError("worker lease is not active")
        if current >= claims.expires_at:
            self._leases[lease_id] = replace(claims, state="expired")
            raise LocalWorkerProtocolError("worker lease has expired")
        if not secrets.compare_digest(claims.token_digest, self._digest(token)):
            raise LocalWorkerProtocolError("worker lease token is invalid")
        if (
            claims.job_id != job_id
            or claims.workspace_id != workspace_id
            or claims.space_id != space_id
            or claims.input_sha256 != input_sha256
        ):
            raise LocalWorkerProtocolError("worker lease scope or input does not match")
        return claims

    def _validate_result_lease(
        self,
        *,
        lease_id: UUID,
        token: str,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        now: datetime | None,
    ) -> ServerLease:
        """Validate a result retry while allowing its same completed lease."""

        claims = self._leases.get(lease_id)
        current = self._utc(now)
        self._validate_hash(input_sha256)
        if claims is None or claims.state not in {"active", "completed"}:
            raise LocalWorkerProtocolError("worker lease is not active")
        if current >= claims.expires_at:
            self._leases[lease_id] = replace(claims, state="expired")
            raise LocalWorkerProtocolError("worker lease has expired")
        if not secrets.compare_digest(claims.token_digest, self._digest(token)):
            raise LocalWorkerProtocolError("worker lease token is invalid")
        if (
            claims.job_id != job_id
            or claims.workspace_id != workspace_id
            or claims.space_id != space_id
            or claims.input_sha256 != input_sha256
        ):
            raise LocalWorkerProtocolError("worker lease scope or input does not match")
        return claims

    def _utc(self, value: datetime | None) -> datetime:
        current = value or self._clock()
        if current.tzinfo is None:
            raise LocalWorkerProtocolError("worker timestamps require timezone")
        return current.astimezone(UTC)

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @classmethod
    def _result_digest(cls, job_id: UUID, input_sha256: str, output_sha256: str) -> str:
        return cls._digest(f"{job_id}:{input_sha256}:{output_sha256}")

    @staticmethod
    def _validate_hash(value: str) -> None:
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise LocalWorkerProtocolError("worker input/output hash is invalid")

    @staticmethod
    def _validate_idempotency_key(value: str) -> None:
        encoded = value.encode("utf-8")
        if (
            not value
            or len(encoded) > MAX_IDEMPOTENCY_KEY_BYTES
            or any(ord(char) < 0x21 or ord(char) > 0x7E for char in value)
        ):
            raise LocalWorkerProtocolError("result idempotency key is invalid")
