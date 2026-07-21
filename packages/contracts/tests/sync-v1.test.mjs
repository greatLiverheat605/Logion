import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const syncSchema = JSON.parse(
  await readFile(
    resolve(packageRoot, "schemas", "sync-v1.schema.json"),
    "utf8",
  ),
);
const operationSchema = JSON.parse(
  await readFile(
    resolve(packageRoot, "schemas", "sync-operation.schema.json"),
    "utf8",
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(syncSchema);
const validateMessage = ajv.getSchema(syncSchema.$id);
const validateOperation = ajv.compile(operationSchema);

assert.ok(validateMessage, "sync-v1 schema must compile");

const ids = {
  device: "01900000-0000-7000-8000-000000000002",
  entity: "01900000-0000-7000-8000-000000000004",
  epoch: "01900000-0000-7000-8000-000000000003",
  operation: "01900000-0000-7000-8000-000000000005",
  user: "01900000-0000-7000-8000-000000000006",
  workspace: "01900000-0000-7000-8000-000000000001",
};
const hash = `sha256:${"a".repeat(64)}`;

const operation = {
  operation_id: ids.operation,
  protocol_version: "sync-v1",
  workspace_id: ids.workspace,
  device_id: ids.device,
  entity_type: "note",
  entity_id: ids.entity,
  operation_type: "update",
  base_version: 1,
  client_occurred_at: "2026-07-21T00:00:00Z",
  payload: { markdown: "offline edit" },
  payload_hash: hash,
  dependencies: [],
};

function assertValid(value) {
  assert.equal(
    validateMessage(value),
    true,
    JSON.stringify(validateMessage.errors),
  );
}

function assertInvalid(value) {
  assert.equal(validateMessage(value), false, "message must fail closed");
}

test("the compatibility and operation schemas resolve", () => {
  assert.equal(
    validateOperation(operation),
    true,
    JSON.stringify(validateOperation.errors),
  );
});

test("validates capabilities and bootstrap envelopes", () => {
  assertValid({
    message_type: "bootstrap_request",
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    known_sync_epoch: null,
    snapshot_id: null,
    chunk_index: null,
  });
  assertValid({
    message_type: "capabilities",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    sync_epoch: ids.epoch,
    snapshot_schema_version: 1,
    max_push_operations: 100,
    max_pull_changes: 500,
    max_operation_bytes: 262144,
    max_batch_bytes: 4194304,
    max_snapshot_chunk_bytes: 4194304,
    server_time: "2026-07-21T00:00:00Z",
  });
  assertValid({
    message_type: "bootstrap_response",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    snapshot_schema_version: 1,
    snapshot_id: "01900000-0000-7000-8000-000000000009",
    chunk_index: 0,
    chunk_count: 1,
    cursor: 12,
    snapshot_checksum: hash,
    chunk_checksum: hash,
    records: [
      {
        entity_type: "note",
        entity_id: ids.entity,
        version: 1,
        created_at: "2026-07-21T00:00:00Z",
        updated_at: "2026-07-21T00:00:00Z",
        deleted_at: null,
        created_by: ids.user,
        updated_by: ids.user,
        payload: { markdown: "snapshot" },
        payload_hash: hash,
      },
    ],
    created_at: "2026-07-21T00:00:00Z",
  });
});

test("bounds snapshot chunks before an atomic bootstrap switch", () => {
  const record = {
    entity_type: "note",
    entity_id: ids.entity,
    version: 1,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload: {},
    payload_hash: hash,
  };
  assertInvalid({
    message_type: "bootstrap_response",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    snapshot_schema_version: 1,
    snapshot_id: "01900000-0000-7000-8000-000000000009",
    chunk_index: 0,
    chunk_count: 2,
    cursor: 12,
    snapshot_checksum: hash,
    chunk_checksum: hash,
    records: Array.from({ length: 1001 }, () => record),
    created_at: "2026-07-21T00:00:00Z",
  });
});

test("validates partial push results without hiding conflicts", () => {
  const resolution = {
    ...operation,
    conflict_resolution: {
      conflict_id: "01900000-0000-7000-8000-000000000007",
      resolution: "merge",
      expected_remote_version: 2,
    },
  };
  assert.equal(
    validateOperation(resolution),
    true,
    JSON.stringify(validateOperation.errors),
  );
  assertValid({
    message_type: "push_request",
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    operations: [operation],
  });
  assertValid({
    message_type: "push_response",
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    results: [
      {
        operation_id: ids.operation,
        status: "conflict",
        retryable: false,
        conflict: {
          conflict_id: "01900000-0000-7000-8000-000000000007",
          conflict_kind: "status",
          status: "open",
          entity_type: "note",
          entity_id: ids.entity,
          base_version: 1,
          local_payload_hash: hash,
          remote_version: 2,
          remote_payload: { markdown: "remote edit" },
          remote_payload_hash: `sha256:${"b".repeat(64)}`,
          resolution_options: ["keep_local", "keep_remote"],
          created_at: "2026-07-21T00:01:00Z",
        },
      },
      {
        operation_id: "01900000-0000-7000-8000-000000000008",
        status: "blocked_dependency",
        retryable: true,
        error_code: "SYNC_DEPENDENCY_BLOCKED",
      },
    ],
  });
});

test("validates ordered pull pages and explicit tombstones", () => {
  assertValid({
    message_type: "pull_response",
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    from_cursor: 10,
    next_cursor: 11,
    has_more: false,
    changes: [
      {
        sequence: 11,
        operation_id: ids.operation,
        entity_type: "note",
        entity_id: ids.entity,
        operation_type: "delete",
        server_version: 2,
        occurred_at: "2026-07-21T00:02:00Z",
        tombstone: true,
        deleted_at: "2026-07-21T00:02:00Z",
        payload: {},
        payload_hash: hash,
      },
    ],
  });
});

test("rejects unknown versions, enums, fields and malformed hashes", () => {
  for (const invalid of [
    { ...operation, protocol_version: "sync-v2" },
    { ...operation, operation_type: "overwrite" },
    { ...operation, payload_hash: "sha256:not-a-hash" },
    { ...operation, access_token: "must-never-enter-sync" },
  ]) {
    assert.equal(
      validateOperation(invalid),
      false,
      "operation must fail closed",
    );
  }
  assertInvalid({
    message_type: "sync_control",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    action: "continue_anyway",
    reason_code: "EPOCH_MISMATCH",
    server_sync_epoch: ids.epoch,
  });
});

test("requires a re-bootstrap control message for epoch mismatch", () => {
  assertValid({
    message_type: "sync_control",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    action: "rebootstrap_required",
    reason_code: "EPOCH_MISMATCH",
    server_sync_epoch: ids.epoch,
  });
});
