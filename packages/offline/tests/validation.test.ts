import { describe, expect, it } from "vitest";

import {
  LogionOfflineDatabase,
  hashPayload,
  normalizeStorageError,
  OfflineStorageError,
  validateMutation,
  validatePayload,
  validateSyncErrorCode,
  validateUuid,
  type LocalMutationInput,
} from "../src";
import { hashCanonicalJson } from "../src/hashing";

const valid: LocalMutationInput = {
  operation_id: "01900000-0000-7000-8000-000000000005",
  protocol_version: "sync-v1",
  workspace_id: "01900000-0000-7000-8000-000000000001",
  device_id: "01900000-0000-7000-8000-000000000002",
  entity_type: "note",
  entity_id: "01900000-0000-7000-8000-000000000003",
  operation_type: "create",
  base_version: 0,
  local_revision: 1,
  client_occurred_at: "2026-07-21T00:00:00Z",
  created_at: "2026-07-21T00:00:00Z",
  updated_at: "2026-07-21T00:00:00Z",
  deleted_at: null,
  created_by: "01900000-0000-7000-8000-000000000007",
  updated_by: "01900000-0000-7000-8000-000000000007",
  payload: { markdown: "valid" },
};

function invalidMutation(overrides: Record<string, unknown>): void {
  expect(() => {
    validateMutation({ ...valid, ...overrides });
  }).toThrow(OfflineStorageError);
}

describe("offline validation and public errors", () => {
  it("normalizes storage errors without serializing their cause", () => {
    const existing = new OfflineStorageError("OFFLINE_INPUT_INVALID");
    expect(normalizeStorageError(existing)).toBe(existing);
    expect(
      normalizeStorageError(new DOMException("full", "QuotaExceededError")),
    ).toMatchObject({ code: "OFFLINE_QUOTA_EXCEEDED", retryable: true });
    expect(
      normalizeStorageError(new DOMException("future", "VersionError")),
    ).toMatchObject({
      code: "OFFLINE_SCHEMA_UPGRADE_REQUIRED",
      retryable: false,
    });
    const generic = normalizeStorageError(new Error("private payload"));
    expect(generic).toMatchObject({
      code: "OFFLINE_TRANSACTION_FAILED",
      retryable: true,
    });
    expect(JSON.stringify(generic)).toBe(
      '{"code":"OFFLINE_TRANSACTION_FAILED","retryable":true}',
    );
  });

  it("rejects non-JSON, cyclic, deep and oversized structures", () => {
    for (const value of [null, [], "text", 1, Number.NaN, new Date()]) {
      expect(() => {
        validatePayload(value);
      }).toThrow(OfflineStorageError);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => {
      validatePayload(cyclic);
    }).toThrow(OfflineStorageError);

    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let index = 0; index < 22; index += 1) {
      deep.child = {};
      deep = deep.child as Record<string, unknown>;
    }
    expect(() => {
      validatePayload(root);
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload({ items: Array(1001).fill(null) });
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload(
        Object.fromEntries(
          Array.from({ length: 201 }, (_, index) => [
            `key${String(index)}`,
            index,
          ]),
        ),
      );
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload({ "": true });
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload({ ["x".repeat(129)]: true });
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload(JSON.parse('{"__proto__":true}') as unknown);
    }).toThrow(OfflineStorageError);
    expect(() => {
      validatePayload({ number: Number.POSITIVE_INFINITY });
    }).toThrow(OfflineStorageError);
  });

  it("rejects malformed operation metadata and state transitions", () => {
    invalidMutation({ protocol_version: "sync-v2" });
    invalidMutation({ operation_type: "overwrite" });
    invalidMutation({ entity_type: "N" });
    invalidMutation({ base_version: -1 });
    invalidMutation({ local_revision: 0 });
    invalidMutation({ dependencies: [valid.operation_id] });
    invalidMutation({
      dependencies: [valid.device_id, valid.device_id],
    });
    invalidMutation({
      dependencies: Array.from(
        { length: 101 },
        (_, index) =>
          `01900000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`,
      ),
    });
    invalidMutation({ client_occurred_at: "yesterday" });
    invalidMutation({
      operation_type: "delete",
      deleted_at: null,
      payload: {},
    });
    invalidMutation({ deleted_at: "2026-07-21T00:01:00Z" });
    invalidMutation({
      updated_at: "2026-07-20T00:00:00Z",
    });
  });

  it("validates identifiers and minimal sync error codes", () => {
    expect(() => {
      validateUuid(valid.workspace_id);
    }).not.toThrow();
    expect(() => {
      validateUuid(null);
    }).toThrow(OfflineStorageError);
    expect(() => {
      validateSyncErrorCode(null);
    }).not.toThrow();
    expect(() => {
      validateSyncErrorCode("SYNC_CONFLICT");
    }).not.toThrow();
    expect(() => {
      validateSyncErrorCode("database connection failed");
    }).toThrow(OfflineStorageError);
  });

  it("fails before constructing Dexie without browser primitives", () => {
    expect(
      () =>
        new LogionOfflineDatabase({
          databaseName: "unavailable",
          indexedDB: null,
          IDBKeyRange: null,
        }),
    ).toThrow(OfflineStorageError);
  });

  it("fails closed when Web Crypto is unavailable", async () => {
    await expect(
      hashPayload({ value: true }, 1024, null),
    ).rejects.toMatchObject({ code: "OFFLINE_CRYPTO_UNAVAILABLE" });
    await expect(hashPayload({ value: true }, -1)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await expect(
      hashCanonicalJson(undefined, 1024, "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE"),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });
});
