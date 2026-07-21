import assert from "node:assert/strict";
import test from "node:test";

import {
  isSyncV1Message,
  validateSyncV1Message,
} from "../src/sync-v1-validator.js";

const ids = {
  device: "01900000-0000-7000-8000-000000000002",
  epoch: "01900000-0000-7000-8000-000000000003",
  snapshot: "01900000-0000-7000-8000-000000000009",
  workspace: "01900000-0000-7000-8000-000000000001",
};
const hash = `sha256:${"a".repeat(64)}`;

function bootstrap(overrides = {}) {
  return {
    message_type: "bootstrap_response",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epoch,
    snapshot_schema_version: 1,
    snapshot_id: ids.snapshot,
    chunk_index: 0,
    chunk_count: 1,
    cursor: 12,
    snapshot_checksum: hash,
    chunk_checksum: hash,
    records: [],
    created_at: "2026-07-21T00:00:00Z",
    ...overrides,
  };
}

test("exports a runtime type guard for valid sync-v1 messages", () => {
  const message = bootstrap();
  assert.equal(isSyncV1Message(message), true);
  assert.deepEqual(validateSyncV1Message(message), {
    ok: true,
    value: message,
  });
});

test("fails closed for malformed and forward-unknown bootstrap messages", () => {
  for (const message of [
    bootstrap({ protocol_version: "sync-v2" }),
    bootstrap({ workspace_id: "not-a-uuid" }),
    bootstrap({ chunk_checksum: "sha256:not-a-hash" }),
    bootstrap({ future_field: true }),
    bootstrap({ records: Array.from({ length: 1001 }, () => ({})) }),
  ]) {
    assert.equal(isSyncV1Message(message), false);
    assert.equal(validateSyncV1Message(message).ok, false);
  }
});

test("returns bounded schema-only diagnostics without rejected values", () => {
  const secret = "PRIVATE_NOTE_CONTENT_MUST_NOT_LEAK";
  const result = validateSyncV1Message(
    bootstrap({
      protocol_version: secret,
      future_field: secret,
      workspace_id: secret,
      device_id: secret,
      sync_epoch: secret,
      snapshot_id: secret,
      snapshot_checksum: secret,
      chunk_checksum: secret,
      created_at: secret,
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(result.diagnostics.length <= 8);
  for (const diagnostic of result.diagnostics) {
    assert.deepEqual(Object.keys(diagnostic).sort(), [
      "keyword",
      "schema_path",
    ]);
    assert.ok(diagnostic.keyword.length <= 160);
    assert.ok(diagnostic.schema_path.length <= 160);
  }
});

test("fails closed without throwing when object access is hostile", () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("hostile getter");
      },
    },
  );

  assert.equal(isSyncV1Message(hostile), false);
  assert.deepEqual(validateSyncV1Message(hostile), {
    ok: false,
    code: "SYNC_MESSAGE_INVALID",
    diagnostics: [{ keyword: "runtime", schema_path: "#" }],
    truncated: false,
  });
});
