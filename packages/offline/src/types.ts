import type { SyncOperationV1 } from "@logion/contracts";

export const OFFLINE_SCHEMA_VERSION = 1 as const;

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
  outbox_state: OutboxState;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  queued_at: string;
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
  schema_version: typeof OFFLINE_SCHEMA_VERSION;
  sync_epoch: string | null;
  cursor: number;
  bootstrap_state: BootstrapState;
  last_sync_at: string | null;
  outbox_isolated_at: string | null;
  isolation_reason_code: string | null;
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
