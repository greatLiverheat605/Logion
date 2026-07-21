from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Hash = Annotated[str, StringConstraints(pattern=r"^sha256:[a-f0-9]{64}$")]
EntityType = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,63}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConflictResolution(StrictModel):
    conflict_id: UUID
    resolution: Literal["keep_local", "keep_remote", "merge", "dismiss"]
    expected_remote_version: int = Field(ge=1)


class SyncOperation(StrictModel):
    operation_id: UUID
    protocol_version: Literal["sync-v1"]
    workspace_id: UUID
    device_id: UUID
    entity_type: EntityType
    entity_id: UUID
    operation_type: Literal["create", "update", "delete", "restore"]
    base_version: int = Field(ge=0)
    client_occurred_at: datetime
    payload: dict[str, object]
    payload_hash: Hash
    conflict_resolution: ConflictResolution | None = None
    dependencies: list[UUID] = Field(max_length=100)

    @model_validator(mode="after")
    def validate_contract_limits(self) -> "SyncOperation":
        if self.client_occurred_at.tzinfo is None:
            raise ValueError("client_occurred_at must include a timezone")
        if len(self.payload) > 200:
            raise ValueError("payload contains too many properties")
        if len(self.dependencies) != len(set(self.dependencies)):
            raise ValueError("dependencies must be unique")
        return self


class PushRequest(StrictModel):
    message_type: Literal["push_request"]
    protocol_version: Literal["sync-v1"]
    workspace_id: UUID
    device_id: UUID
    sync_epoch: UUID
    operations: list[SyncOperation] = Field(min_length=1, max_length=100)


class AppliedOperationResult(StrictModel):
    operation_id: UUID
    status: Literal["applied", "duplicate"]
    retryable: Literal[False] = False
    server_version: int = Field(ge=1)
    sequence: int = Field(ge=1)


class FailedOperationResult(StrictModel):
    operation_id: UUID
    status: Literal["rejected", "blocked_dependency"]
    retryable: bool
    error_code: Annotated[str, StringConstraints(pattern=r"^SYNC_[A-Z0-9_]{2,80}$")]


OperationResult = AppliedOperationResult | FailedOperationResult


class PushResponse(StrictModel):
    message_type: Literal["push_response"] = "push_response"
    protocol_version: Literal["sync-v1"] = "sync-v1"
    workspace_id: UUID
    device_id: UUID
    sync_epoch: UUID
    results: list[OperationResult] = Field(min_length=1, max_length=100)


class RebootstrapControl(StrictModel):
    message_type: Literal["sync_control"] = "sync_control"
    protocol_version: Literal["sync-v1"] = "sync-v1"
    min_supported_version: Literal["sync-v1"] = "sync-v1"
    action: Literal["rebootstrap_required"] = "rebootstrap_required"
    reason_code: Literal["EPOCH_MISMATCH"] = "EPOCH_MISMATCH"
    server_sync_epoch: UUID


class CursorExpiredControl(StrictModel):
    message_type: Literal["sync_control"] = "sync_control"
    protocol_version: Literal["sync-v1"] = "sync-v1"
    min_supported_version: Literal["sync-v1"] = "sync-v1"
    action: Literal["cursor_expired"] = "cursor_expired"
    reason_code: Literal["CURSOR_EXPIRED"] = "CURSOR_EXPIRED"
    server_sync_epoch: UUID


class PullRequest(StrictModel):
    message_type: Literal["pull_request"]
    protocol_version: Literal["sync-v1"]
    workspace_id: UUID
    device_id: UUID
    sync_epoch: UUID
    cursor: int = Field(ge=0)
    limit: int = Field(ge=1, le=1000)


class Change(StrictModel):
    sequence: int = Field(ge=1)
    operation_id: UUID
    entity_type: EntityType
    entity_id: UUID
    operation_type: Literal["create", "update", "delete", "restore"]
    server_version: int = Field(ge=1)
    occurred_at: datetime
    tombstone: bool
    deleted_at: datetime | None
    payload: dict[str, object]
    payload_hash: Hash


class PullResponse(StrictModel):
    message_type: Literal["pull_response"] = "pull_response"
    protocol_version: Literal["sync-v1"] = "sync-v1"
    workspace_id: UUID
    device_id: UUID
    sync_epoch: UUID
    from_cursor: int = Field(ge=0)
    next_cursor: int = Field(ge=0)
    has_more: bool
    changes: list[Change] = Field(max_length=1000)


class BootstrapRequest(StrictModel):
    message_type: Literal["bootstrap_request"]
    protocol_version: Literal["sync-v1"]
    workspace_id: UUID
    device_id: UUID
    known_sync_epoch: UUID | None
    snapshot_id: UUID | None
    chunk_index: int | None = Field(ge=0)


class EntityRecord(StrictModel):
    entity_type: EntityType
    entity_id: UUID
    version: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    created_by: UUID
    updated_by: UUID
    payload: dict[str, object]
    payload_hash: Hash


class BootstrapResponse(StrictModel):
    message_type: Literal["bootstrap_response"] = "bootstrap_response"
    protocol_version: Literal["sync-v1"] = "sync-v1"
    min_supported_version: Literal["sync-v1"] = "sync-v1"
    workspace_id: UUID
    device_id: UUID
    sync_epoch: UUID
    snapshot_schema_version: Literal[1] = 1
    snapshot_id: UUID
    chunk_index: int = Field(ge=0)
    chunk_count: int = Field(ge=1, le=100000)
    cursor: int = Field(ge=0)
    snapshot_checksum: Hash
    chunk_checksum: Hash
    records: list[EntityRecord] = Field(max_length=1000)
    created_at: datetime
