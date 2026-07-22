import type { EntityRecord, SyncOperationV1 } from "@logion/contracts";

export const OFFLINE_SCHEMA_VERSION = 3 as const;

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type LocalSyncStatus = "clean" | "conflict" | "pending";
export type OutboxState =
  | "blocked"
  | "conflict"
  | "in_flight"
  | "isolated"
  | "pending";

export interface LocalEntity {
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  server_version: number;
  local_revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
  payload: JsonObject;
  payload_hash: string;
  sync_status: LocalSyncStatus;
}

export interface OutboxEntry extends SyncOperationV1 {
  payload_vault_id?: string;
  outbox_state: OutboxState;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  queued_at: string;
}

export interface ProtectedMutationInput extends LocalMutationInput {
  entity_type:
    | "evidence"
    | "learning_goal"
    | "mastery"
    | "note"
    | "quiz_attempt"
    | "quiz_item"
    | "resource"
    | "error_pattern"
    | "exam"
    | "exam_subject"
    | "syllabus_node"
    | "mock_exam"
    | "score_record"
    | "learning_track"
    | "study_project"
    | "inbox_item"
    | "deliverable"
    | "paper_record"
    | "research_claim"
    | "research_question"
    | "experiment_run"
    | "metric_record"
    | "research_feedback"
    | "audit_review"
    | "review_finding"
    | "review_schedule"
    | "study_session"
    | "task"
    | "topic"
    | "topic_dependency"
    | "verification";
}

export type BootstrapState =
  | "empty"
  | "ready"
  | "rebootstrap_required"
  | "staging"
  | "upgrade_required";

export interface WorkspaceSyncState {
  workspace_id: string;
  device_id: string;
  schema_version: 1 | 2 | typeof OFFLINE_SCHEMA_VERSION;
  sync_epoch: string | null;
  cursor: number;
  bootstrap_state: BootstrapState;
  last_sync_at: string | null;
  outbox_isolated_at: string | null;
  isolation_reason_code: string | null;
}

export type BootstrapManifestStatus = "complete" | "staging";

export interface BootstrapReceivedChunk {
  chunk_index: number;
  chunk_checksum: string;
}

export interface BootstrapManifest {
  workspace_id: string;
  snapshot_id: string;
  device_id: string;
  sync_epoch: string;
  snapshot_schema_version: 1;
  chunk_count: number;
  cursor: number;
  snapshot_checksum: string;
  created_at: string;
  received_chunks: BootstrapReceivedChunk[];
  received_records: number;
  status: BootstrapManifestStatus;
}

export interface BootstrapStagedRecord extends EntityRecord {
  workspace_id: string;
  snapshot_id: string;
  chunk_index: number;
  record_index: number;
  payload: JsonObject;
}

export interface BootstrapContext {
  workspace_id: string;
  device_id: string;
}

export interface BootstrapProgress {
  workspace_id: string;
  snapshot_id: string;
  received_chunks: number;
  chunk_count: number;
  received_records: number;
  complete: boolean;
}

export interface BootstrapRepositoryOptions {
  maxOperationBytes?: number;
  maxSnapshotChunkBytes?: number;
  subtleCrypto?: SubtleCrypto | null;
}

export interface LocalMutationInput {
  operation_id: string;
  protocol_version: "sync-v1";
  workspace_id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: "create" | "delete" | "restore" | "update";
  base_version: number;
  local_revision: number;
  client_occurred_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  created_by: string;
  updated_by: string;
  payload: JsonObject;
  dependencies?: string[];
}

export interface OfflineDatabaseOptions {
  databaseName: string;
  indexedDB: IDBFactory | null;
  IDBKeyRange: typeof globalThis.IDBKeyRange | null;
}

export type ConflictStatus =
  | "open"
  | "resolved_local"
  | "resolved_merge"
  | "resolved_remote"
  | "dismissed";

export interface LocalConflict {
  conflict_id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  status: ConflictStatus;
  conflict_kind:
    | "content"
    | "delete_update"
    | "hierarchy"
    | "permission"
    | "status";
  base_version: number;
  local_payload: JsonObject;
  local_payload_hash: string;
  remote_version: number;
  remote_payload: JsonObject;
  remote_payload_hash: string;
  resolution_options: ("dismiss" | "keep_local" | "keep_remote" | "merge")[];
  created_at: string;
  resolved_at: string | null;
}

export type AttachmentQueueState =
  | "failed"
  | "pending_upload"
  | "uploading"
  | "verified";

export interface AttachmentQueueEntry {
  attachment_id: string;
  workspace_id: string;
  device_id: string;
  filename: string;
  media_type: "image/jpeg" | "image/png" | "text/plain";
  byte_size: number;
  sha256: string;
  state: AttachmentQueueState;
  blob: Blob;
  queued_at: string;
  last_error_code: string | null;
}

export interface VaultMetadata {
  user_id: string;
  salt: string;
  verifier_iv: string;
  verifier_ciphertext: string;
  iterations: number;
  created_at: string;
}

export interface VaultRecord {
  record_id: string;
  workspace_id: string;
  iv: string;
  ciphertext: string;
  updated_at: string;
}
