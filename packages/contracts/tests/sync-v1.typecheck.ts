import type {
  LogionSyncV1Message,
  PushRequest,
  SyncOperationV1,
} from "../src/sync-v1";
import {
  isSyncV1Message,
  validateSyncV1Message,
} from "../src/sync-v1-validator.js";

const operation: SyncOperationV1 = {
  operation_id: "01900000-0000-7000-8000-000000000005",
  protocol_version: "sync-v1",
  workspace_id: "01900000-0000-7000-8000-000000000001",
  device_id: "01900000-0000-7000-8000-000000000002",
  entity_type: "note",
  entity_id: "01900000-0000-7000-8000-000000000004",
  operation_type: "update",
  base_version: 1,
  client_occurred_at: "2026-07-21T00:00:00Z",
  payload: { markdown: "offline edit" },
  payload_hash: `sha256:${"a".repeat(64)}`,
  dependencies: [],
};

const valid: PushRequest = {
  message_type: "push_request",
  protocol_version: "sync-v1",
  workspace_id: operation.workspace_id,
  device_id: operation.device_id,
  sync_epoch: "01900000-0000-7000-8000-000000000003",
  operations: [operation],
};

void valid;

const invalid: PushRequest = {
  message_type: "push_request",
  protocol_version: "sync-v1",
  workspace_id: operation.workspace_id,
  device_id: operation.device_id,
  sync_epoch: "01900000-0000-7000-8000-000000000003",
  operations: [operation],
  // @ts-expect-error Sync envelopes fail closed on undeclared fields.
  access_token: "must-not-compile",
};

void invalid;

declare const unknownMessage: unknown;
if (isSyncV1Message(unknownMessage)) {
  const message: LogionSyncV1Message = unknownMessage;
  void message;
}
const validation = validateSyncV1Message(unknownMessage);
if (validation.ok) {
  const message: LogionSyncV1Message = validation.value;
  void message;
}
