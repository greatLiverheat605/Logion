"""Fail-closed lease and checkpoint primitives for a future local worker.

This module deliberately has no API route, database writer, provider client, or
production enablement hook. It stores only bounded metadata and hashes, so it
can be exercised before a local execution path is authorized.
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final, Literal
from uuid import UUID, uuid4

LeaseState = Literal["active", "revoked", "expired", "completed"]
CheckpointStage = Literal["claimed", "running", "uploaded"]
_STAGES: Final[frozenset[str]] = frozenset({"claimed", "running", "uploaded"})
_STAGE_ORDER: Final[dict[CheckpointStage, int]] = {
    "claimed": 0,
    "running": 1,
    "uploaded": 2,
}
MAX_CHECKPOINT_BYTES: Final[int] = 16 * 1024
_KNOWN_JOB_ARTIFACTS: Final[frozenset[str]] = frozenset({"checkpoint.json", "checkpoint.json.part"})


class WorkerSecurityError(ValueError):
    """A lease, checkpoint, or residue operation failed closed."""


@dataclass(frozen=True)
class LeaseClaims:
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
class Checkpoint:
    job_id: UUID
    lease_id: UUID
    workspace_id: UUID
    space_id: UUID
    input_sha256: str
    stage: CheckpointStage
    output_sha256: str | None
    updated_at: datetime


class LocalWorkerSecurity:
    """Issue and validate short-lived, scope-bound local-worker leases."""

    def __init__(
        self,
        root: str | Path,
        *,
        lease_seconds: int = 120,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if not 30 <= lease_seconds <= 600:
            raise WorkerSecurityError("lease duration must be between 30 and 600 seconds")
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        if self._root.is_symlink():
            raise WorkerSecurityError("worker root must not be a symbolic link")
        self._lease_seconds = lease_seconds
        self._clock = clock or (lambda: datetime.now(UTC))
        self._leases: dict[UUID, LeaseClaims] = {}

    def issue_lease(
        self,
        *,
        job_id: UUID,
        workspace_id: UUID,
        space_id: UUID,
        input_sha256: str,
        now: datetime | None = None,
    ) -> tuple[LeaseClaims, str]:
        self._validate_hash(input_sha256)
        issued_at = self._utc(now)
        lease_id = uuid4()
        token = secrets.token_urlsafe(32)
        claims = LeaseClaims(
            lease_id=lease_id,
            job_id=job_id,
            workspace_id=workspace_id,
            space_id=space_id,
            input_sha256=input_sha256,
            issued_at=issued_at,
            expires_at=issued_at + timedelta(seconds=self._lease_seconds),
            token_digest=self._digest(token),
        )
        self._leases[lease_id] = claims
        return claims, token

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
    ) -> LeaseClaims:
        self._validate_hash(input_sha256)
        claims = self._leases.get(lease_id)
        current = self._utc(now)
        if claims is None or claims.state != "active":
            raise WorkerSecurityError("worker lease is not active")
        if current >= claims.expires_at:
            self._leases[lease_id] = replace(claims, state="expired")
            raise WorkerSecurityError("worker lease has expired")
        if not secrets.compare_digest(claims.token_digest, self._digest(token)):
            raise WorkerSecurityError("worker lease token is invalid")
        if (
            claims.job_id != job_id
            or claims.workspace_id != workspace_id
            or claims.space_id != space_id
            or claims.input_sha256 != input_sha256
        ):
            raise WorkerSecurityError("worker lease scope or input does not match")
        return claims

    def revoke(self, lease_id: UUID) -> None:
        claims = self._leases.get(lease_id)
        if claims is None:
            raise WorkerSecurityError("worker lease is unknown")
        if claims.state == "completed":
            raise WorkerSecurityError("completed worker lease cannot be revoked")
        self._leases[lease_id] = replace(claims, state="revoked")

    def write_checkpoint(
        self,
        claims: LeaseClaims,
        *,
        token: str,
        stage: CheckpointStage,
        output_sha256: str | None = None,
        now: datetime | None = None,
    ) -> Checkpoint:
        if stage not in _STAGES:
            raise WorkerSecurityError("checkpoint stage is invalid")
        self.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=claims.job_id,
            workspace_id=claims.workspace_id,
            space_id=claims.space_id,
            input_sha256=claims.input_sha256,
            now=now,
        )
        if output_sha256 is not None:
            self._validate_hash(output_sha256)
        job_dir = self._job_dir(claims.job_id)
        self._reject_unknown_artifacts(job_dir)
        checkpoint_path = job_dir / "checkpoint.json"
        if checkpoint_path.is_symlink():
            raise WorkerSecurityError("worker checkpoint must not be a symbolic link")
        if checkpoint_path.exists():
            previous = self.load_checkpoint(claims, token=token)
            if _STAGE_ORDER[stage] < _STAGE_ORDER[previous.stage]:
                raise WorkerSecurityError("checkpoint stage cannot move backwards")
        if stage == "uploaded" and output_sha256 is None:
            raise WorkerSecurityError("uploaded checkpoint requires an output hash")
        checkpoint = Checkpoint(
            job_id=claims.job_id,
            lease_id=claims.lease_id,
            workspace_id=claims.workspace_id,
            space_id=claims.space_id,
            input_sha256=claims.input_sha256,
            stage=stage,
            output_sha256=output_sha256,
            updated_at=self._utc(now),
        )
        job_dir.mkdir(parents=True, exist_ok=True)
        temporary = job_dir / "checkpoint.json.part"
        target = job_dir / "checkpoint.json"
        payload = json.dumps(self._checkpoint_dict(checkpoint), sort_keys=True).encode("utf-8")
        if len(payload) > MAX_CHECKPOINT_BYTES:
            raise WorkerSecurityError("worker checkpoint exceeds size limit")
        try:
            with temporary.open("xb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, target)
        except FileExistsError as exc:
            raise WorkerSecurityError("worker checkpoint write is already in progress") from exc
        finally:
            if temporary.exists() and not temporary.is_symlink():
                temporary.unlink()
        if stage == "uploaded":
            self._leases[claims.lease_id] = replace(claims, state="completed")
        return checkpoint

    def load_checkpoint(self, claims: LeaseClaims, *, token: str) -> Checkpoint:
        self.validate_lease(
            lease_id=claims.lease_id,
            token=token,
            job_id=claims.job_id,
            workspace_id=claims.workspace_id,
            space_id=claims.space_id,
            input_sha256=claims.input_sha256,
        )
        path = self._job_dir(claims.job_id) / "checkpoint.json"
        self._reject_unknown_artifacts(path.parent)
        if path.is_symlink():
            raise WorkerSecurityError("worker checkpoint must not be a symbolic link")
        try:
            if path.stat().st_size > MAX_CHECKPOINT_BYTES:
                raise WorkerSecurityError("worker checkpoint exceeds size limit")
        except FileNotFoundError as exc:
            raise WorkerSecurityError("worker checkpoint is invalid") from exc
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            checkpoint = Checkpoint(
                job_id=UUID(payload["job_id"]),
                lease_id=UUID(payload["lease_id"]),
                workspace_id=UUID(payload["workspace_id"]),
                space_id=UUID(payload["space_id"]),
                input_sha256=payload["input_sha256"],
                stage=payload["stage"],
                output_sha256=payload.get("output_sha256"),
                updated_at=datetime.fromisoformat(payload["updated_at"]),
            )
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise WorkerSecurityError("worker checkpoint is invalid") from exc
        if (
            checkpoint.job_id != claims.job_id
            or checkpoint.lease_id != claims.lease_id
            or checkpoint.workspace_id != claims.workspace_id
            or checkpoint.space_id != claims.space_id
            or checkpoint.input_sha256 != claims.input_sha256
            or checkpoint.stage not in _STAGES
        ):
            raise WorkerSecurityError("worker checkpoint scope or input does not match")
        if checkpoint.output_sha256 is not None:
            self._validate_hash(checkpoint.output_sha256)
        if checkpoint.updated_at.tzinfo is None:
            raise WorkerSecurityError("worker checkpoint timestamp is invalid")
        return checkpoint

    def cleanup_residue(self, *, job_id: UUID | None = None) -> int:
        targets = [self._job_dir(job_id)] if job_id is not None else list(self._root.iterdir())
        removed = 0
        for target in targets:
            if not target.exists() or target.is_symlink():
                continue
            if target.is_file() and target.name.endswith(".part"):
                target.unlink()
                removed += 1
                continue
            if target.is_dir():
                for child in target.iterdir():
                    if child.is_file() and child.name.endswith(".part"):
                        child.unlink()
                        removed += 1
                if job_id is not None and not any(target.iterdir()):
                    target.rmdir()
        return removed

    def cleanup_job(self, job_id: UUID) -> int:
        """Remove only known checkpoint artifacts after terminal completion."""

        job_dir = self._job_dir(job_id)
        if not job_dir.exists() or job_dir.is_symlink():
            return 0
        removed = 0
        for name in ("checkpoint.json", "checkpoint.json.part"):
            path = job_dir / name
            if path.is_file() and not path.is_symlink():
                path.unlink()
                removed += 1
        if not any(job_dir.iterdir()):
            job_dir.rmdir()
        return removed

    @staticmethod
    def _reject_unknown_artifacts(job_dir: Path) -> None:
        if not job_dir.exists():
            return
        if job_dir.is_symlink() or not job_dir.is_dir():
            raise WorkerSecurityError("worker job directory is invalid")
        try:
            unknown = [
                child.name for child in job_dir.iterdir() if child.name not in _KNOWN_JOB_ARTIFACTS
            ]
        except OSError as exc:
            raise WorkerSecurityError("worker job directory is unavailable") from exc
        if unknown:
            raise WorkerSecurityError("worker job contains unknown artifacts")

    def _job_dir(self, job_id: UUID) -> Path:
        path = self._root / str(job_id)
        if path.parent != self._root:
            raise WorkerSecurityError("worker job path escaped root")
        return path

    @staticmethod
    def _checkpoint_dict(checkpoint: Checkpoint) -> dict[str, str | None]:
        return {
            "job_id": str(checkpoint.job_id),
            "lease_id": str(checkpoint.lease_id),
            "workspace_id": str(checkpoint.workspace_id),
            "space_id": str(checkpoint.space_id),
            "input_sha256": checkpoint.input_sha256,
            "stage": checkpoint.stage,
            "output_sha256": checkpoint.output_sha256,
            "updated_at": checkpoint.updated_at.isoformat(),
        }

    def _utc(self, value: datetime | None) -> datetime:
        current = value or self._clock()
        if current.tzinfo is None:
            raise WorkerSecurityError("worker timestamps require timezone")
        return current.astimezone(UTC)

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @staticmethod
    def _validate_hash(value: str) -> None:
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise WorkerSecurityError("worker input/output hash is invalid")
