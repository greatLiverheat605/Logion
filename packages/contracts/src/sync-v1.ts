/* Generated from schemas/sync-v1.schema.json. Do not edit manually. */

/**
 * Versioned envelopes for bootstrap, push, pull and explicit sync control.
 */
export type LogionSyncV1Message =
  | Capabilities
  | BootstrapRequest
  | BootstrapResponse
  | PushRequest
  | PushResponse
  | PullRequest
  | PullResponse
  | SyncControl;
export type Capabilities = BaseMessage & {
  message_type: "capabilities";
  protocol_version: ProtocolVersion;
  min_supported_version: ProtocolVersion;
  sync_epoch: Uuid;
  snapshot_schema_version: 1;
  max_push_operations: number;
  max_pull_changes: number;
  max_operation_bytes: number;
  max_batch_bytes: number;
  max_snapshot_chunk_bytes: number;
  server_time: DateTime;
};
export type ProtocolVersion = "sync-v1";
export type Uuid = string;
export type DateTime = string;
export type BootstrapRequest = BaseMessage &
  WorkspaceDevice & {
    message_type: "bootstrap_request";
    protocol_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    known_sync_epoch: Uuid | null;
    snapshot_id: Uuid | null;
    chunk_index: number | null;
  };
export type BootstrapResponse = BaseMessage &
  WorkspaceDevice & {
    message_type: "bootstrap_response";
    protocol_version: ProtocolVersion;
    min_supported_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    sync_epoch: Uuid;
    snapshot_schema_version: 1;
    snapshot_id: Uuid;
    chunk_index: number;
    chunk_count: number;
    cursor: Cursor;
    snapshot_checksum: Hash;
    chunk_checksum: Hash;
    /**
     * @maxItems 1000
     */
    records: EntityRecord[];
    created_at: DateTime;
  };
export type Cursor = number;
export type Hash = string;
export type EntityType = string;
export type PushRequest = BaseMessage &
  WorkspaceDevice & {
    message_type: "push_request";
    protocol_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    sync_epoch: Uuid;
    /**
     * @minItems 1
     * @maxItems 100
     */
    operations: [SyncOperationV1, ...SyncOperationV1[]];
  };
export type PushResponse = BaseMessage &
  WorkspaceDevice & {
    message_type: "push_response";
    protocol_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    sync_epoch: Uuid;
    /**
     * @minItems 1
     * @maxItems 100
     */
    results: [OperationResult, ...OperationResult[]];
  };
export type OperationResult =
  | AppliedOperationResult
  | ConflictOperationResult
  | FailedOperationResult;
export type PullRequest = BaseMessage &
  WorkspaceDevice & {
    message_type: "pull_request";
    protocol_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    sync_epoch: Uuid;
    cursor: Cursor;
    limit: number;
  };
export type PullResponse = BaseMessage &
  WorkspaceDevice & {
    message_type: "pull_response";
    protocol_version: ProtocolVersion;
    workspace_id: Uuid;
    device_id: Uuid;
    sync_epoch: Uuid;
    from_cursor: Cursor;
    next_cursor: Cursor;
    has_more: boolean;
    /**
     * @maxItems 1000
     */
    changes: Change[];
  };
export type Change = LiveChange | TombstoneChange;
export type SyncControl =
  | UpgradeControl
  | RebootstrapControl
  | CursorExpiredControl;

export interface BaseMessage {
  message_type: string;
  protocol_version: ProtocolVersion;
}
export interface WorkspaceDevice {
  workspace_id: Uuid;
  device_id: Uuid;
}
export interface EntityRecord {
  entity_type: EntityType;
  entity_id: Uuid;
  version: number;
  created_at: DateTime;
  updated_at: DateTime;
  deleted_at: DateTime | null;
  created_by: Uuid;
  updated_by: Uuid;
  payload: Payload;
  payload_hash: Hash;
}
export interface Payload {
  [k: string]: unknown;
}
export interface SyncOperationV1 {
  operation_id: Uuid;
  protocol_version: ProtocolVersion;
  workspace_id: Uuid;
  device_id: Uuid;
  entity_type: EntityType;
  entity_id: Uuid;
  operation_type: "create" | "update" | "delete" | "restore";
  base_version: number;
  client_occurred_at: DateTime;
  payload: Payload;
  payload_hash: Hash;
  conflict_resolution?: ConflictResolution | null;
  /**
   * @maxItems 100
   */
  dependencies: Uuid[];
}
export interface ConflictResolution {
  conflict_id: Uuid;
  resolution: "keep_local" | "keep_remote" | "merge" | "dismiss";
  expected_remote_version: number;
}
export interface AppliedOperationResult {
  operation_id: Uuid;
  status: "applied" | "duplicate";
  retryable: false;
  server_version: number;
  sequence: number;
}
export interface ConflictOperationResult {
  operation_id: Uuid;
  status: "conflict";
  retryable: false;
  conflict: Conflict;
}
export interface Conflict {
  conflict_id: Uuid;
  conflict_kind:
    | "content"
    | "status"
    | "hierarchy"
    | "delete_update"
    | "permission";
  status: "open";
  entity_type: EntityType;
  entity_id: Uuid;
  base_version: number;
  local_payload_hash: Hash;
  remote_version: number;
  remote_payload: Payload;
  remote_payload_hash: Hash;
  /**
   * @minItems 1
   */
  resolution_options: [
    "keep_local" | "keep_remote" | "merge" | "dismiss",
    ...("keep_local" | "keep_remote" | "merge" | "dismiss")[],
  ];
  created_at: DateTime;
}
export interface FailedOperationResult {
  operation_id: Uuid;
  status: "rejected" | "blocked_dependency";
  retryable: boolean;
  error_code: string;
}
export interface LiveChange {
  sequence: number;
  operation_id: Uuid;
  entity_type: EntityType;
  entity_id: Uuid;
  operation_type: "create" | "update" | "restore";
  server_version: number;
  occurred_at: DateTime;
  tombstone: false;
  deleted_at: null;
  payload: Payload;
  payload_hash: Hash;
}
export interface TombstoneChange {
  sequence: number;
  operation_id: Uuid;
  entity_type: EntityType;
  entity_id: Uuid;
  operation_type: "delete";
  server_version: number;
  occurred_at: DateTime;
  tombstone: true;
  deleted_at: DateTime;
  payload: {};
  payload_hash: Hash;
}
export interface UpgradeControl {
  message_type: "sync_control";
  protocol_version: ProtocolVersion;
  min_supported_version: ProtocolVersion;
  action: "upgrade_required";
  reason_code: "PROTOCOL_UNSUPPORTED" | "SNAPSHOT_SCHEMA_UNSUPPORTED";
  server_sync_epoch: Uuid;
}
export interface RebootstrapControl {
  message_type: "sync_control";
  protocol_version: ProtocolVersion;
  min_supported_version: ProtocolVersion;
  action: "rebootstrap_required";
  reason_code: "EPOCH_MISMATCH";
  server_sync_epoch: Uuid;
}
export interface CursorExpiredControl {
  message_type: "sync_control";
  protocol_version: ProtocolVersion;
  min_supported_version: ProtocolVersion;
  action: "cursor_expired";
  reason_code: "CURSOR_EXPIRED";
  server_sync_epoch: Uuid;
}
