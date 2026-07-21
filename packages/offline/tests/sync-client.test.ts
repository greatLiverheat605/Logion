import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  hashPayload,
  OfflineRepository,
  openOfflineDatabase,
  SyncClient,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "../src";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000001",
  device: "01900000-0000-7000-8000-000000000002",
  entity: "01900000-0000-7000-8000-000000000003",
  operation: "01900000-0000-7000-8000-000000000004",
  user: "01900000-0000-7000-8000-000000000005",
  epoch: "01900000-0000-7000-8000-000000000006",
};

let database: LogionOfflineDatabase | undefined;

afterEach(async () => {
  database?.close();
  await database?.delete();
  database = undefined;
});

describe("recoverable push/pull cycle", () => {
  it("acknowledges Outbox operations and advances the cursor atomically", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-sync-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 2,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    await new OfflineRepository(database).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "space",
      entity_id: ids.entity,
      operation_type: "create",
      base_version: 0,
      local_revision: 1,
      client_occurred_at: "2026-07-21T00:00:00Z",
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { name: "Research", visibility: "private" },
    });
    const payloadHash = await hashPayload({
      name: "Research",
      visibility: "private",
    });
    const transport: SyncTransport = {
      async push(request) {
        await Promise.resolve();
        return {
          message_type: "push_response",
          protocol_version: "sync-v1",
          workspace_id: request.workspace_id,
          device_id: request.device_id,
          sync_epoch: request.sync_epoch,
          results: [
            {
              operation_id: ids.operation,
              status: "applied",
              retryable: false,
              server_version: 1,
              sequence: 1,
            },
          ],
        };
      },
      async pull(request) {
        await Promise.resolve();
        return {
          message_type: "pull_response",
          protocol_version: "sync-v1",
          workspace_id: request.workspace_id,
          device_id: request.device_id,
          sync_epoch: request.sync_epoch,
          from_cursor: request.cursor,
          next_cursor: 1,
          has_more: false,
          changes: [
            {
              sequence: 1,
              operation_id: ids.operation,
              entity_type: "space",
              entity_id: ids.entity,
              operation_type: "create",
              server_version: 1,
              occurred_at: "2026-07-21T00:00:01Z",
              tombstone: false,
              deleted_at: null,
              payload: { name: "Research", visibility: "private" },
              payload_hash: payloadHash,
            },
          ],
        };
      },
    };

    const result = await new SyncClient(database, transport).synchronize(
      ids.workspace,
      ids.device,
    );

    expect(result).toMatchObject({ pushed: 1, pulled: 1, control: null });
    expect(await database.outbox.count()).toBe(0);
    expect(await database.syncState.get(ids.workspace)).toMatchObject({
      cursor: 1,
    });
    expect(
      await database.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({ server_version: 1, sync_status: "clean" });
  });

  it("turns epoch and retention controls into a rebootstrap state", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-control-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 2,
      sync_epoch: ids.epoch,
      cursor: 4,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const transport: SyncTransport = {
      async push() {
        await Promise.resolve();
        throw new Error("no push expected");
      },
      async pull() {
        await Promise.resolve();
        return {
          message_type: "sync_control",
          protocol_version: "sync-v1",
          min_supported_version: "sync-v1",
          action: "cursor_expired",
          reason_code: "CURSOR_EXPIRED",
          server_sync_epoch: ids.epoch,
        };
      },
    };

    const result = await new SyncClient(database, transport).synchronize(
      ids.workspace,
      ids.device,
    );

    expect(result).toMatchObject({
      pushed: 0,
      pulled: 0,
      control: "cursor_expired",
    });
    expect(await database.syncState.get(ids.workspace)).toMatchObject({
      bootstrap_state: "rebootstrap_required",
    });
  });

  it("stops before pull when push requires a protocol upgrade", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-upgrade-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 2,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    await new OfflineRepository(database).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "space",
      entity_id: ids.entity,
      operation_type: "create",
      base_version: 0,
      local_revision: 1,
      client_occurred_at: "2026-07-21T00:00:00Z",
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { name: "Upgrade", visibility: "private" },
    });
    const result = await new SyncClient(database, {
      async push() {
        await Promise.resolve();
        return {
          message_type: "sync_control",
          protocol_version: "sync-v1",
          min_supported_version: "sync-v1",
          action: "upgrade_required",
          reason_code: "PROTOCOL_UNSUPPORTED",
          server_sync_epoch: ids.epoch,
        };
      },
      async pull() {
        await Promise.resolve();
        throw new Error("pull must not run");
      },
    }).synchronize(ids.workspace, ids.device);

    expect(result.control).toBe("upgrade_required");
    expect(await database.syncState.get(ids.workspace)).toMatchObject({
      bootstrap_state: "upgrade_required",
    });
  });

  it("preserves the Outbox and cursor when the network fails mid-cycle", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-network-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 3,
      sync_epoch: ids.epoch,
      cursor: 5,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    await new OfflineRepository(database).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "space",
      entity_id: ids.entity,
      operation_type: "create",
      base_version: 0,
      local_revision: 1,
      client_occurred_at: "2026-07-21T00:00:00Z",
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { name: "Offline", visibility: "private" },
    });
    const client = new SyncClient(database, {
      async push() {
        await Promise.resolve();
        throw new TypeError("network unavailable");
      },
      async pull() {
        await Promise.resolve();
        throw new Error("pull must not run");
      },
    });

    await expect(
      client.synchronize(ids.workspace, ids.device),
    ).rejects.toBeDefined();
    expect(await database.outbox.get(ids.operation)).toMatchObject({
      outbox_state: "pending",
    });
    expect(await database.syncState.get(ids.workspace)).toMatchObject({
      cursor: 5,
    });
  });

  it("fails closed when the local Workspace is not bootstrapped for the device", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-invalid-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const client = new SyncClient(database, {
      async push() {
        await Promise.resolve();
        return {};
      },
      async pull() {
        await Promise.resolve();
        return {};
      },
    });

    await expect(
      client.synchronize(ids.workspace, ids.device),
    ).rejects.toMatchObject({
      code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH",
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.user,
      schema_version: 2,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    await expect(
      client.synchronize(ids.workspace, ids.device),
    ).rejects.toMatchObject({
      code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH",
    });
    await database.syncState.update(ids.workspace, {
      device_id: ids.device,
      bootstrap_state: "empty",
    });
    await expect(
      client.synchronize(ids.workspace, ids.device),
    ).rejects.toMatchObject({
      code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH",
    });
  });

  it("marks a pending local entity conflicted instead of overwriting it", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-empty-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 2,
      sync_epoch: ids.epoch,
      cursor: 7,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    await database.entities.put({
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      server_version: 1,
      local_revision: 2,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:02Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { name: "Local" },
      payload_hash: await hashPayload({ name: "Local" }),
      sync_status: "pending",
    });
    const remoteHash = await hashPayload({ name: "Remote" });
    const result = await new SyncClient(database, {
      async push() {
        await Promise.resolve();
        throw new Error("no push expected");
      },
      async pull(request) {
        await Promise.resolve();
        return {
          message_type: "pull_response",
          protocol_version: "sync-v1",
          workspace_id: request.workspace_id,
          device_id: request.device_id,
          sync_epoch: request.sync_epoch,
          from_cursor: 7,
          next_cursor: 8,
          has_more: false,
          changes: [
            {
              sequence: 8,
              operation_id: ids.operation,
              entity_type: "space",
              entity_id: ids.entity,
              operation_type: "update",
              server_version: 2,
              occurred_at: "2026-07-21T00:00:03Z",
              tombstone: false,
              deleted_at: null,
              payload: { name: "Remote" },
              payload_hash: remoteHash,
            },
          ],
        };
      },
    }).synchronize(ids.workspace, ids.device);

    expect(result).toMatchObject({ pushed: 0, pulled: 1 });
    expect(
      await database.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({ sync_status: "conflict", payload: { name: "Local" } });
  });
});
