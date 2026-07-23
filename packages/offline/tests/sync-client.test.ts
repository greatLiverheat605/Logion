import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  hashPayload,
  noteDocumentStateId,
  OfflineRepository,
  OfflineVault,
  ProtectedOfflineRepository,
  openOfflineDatabase,
  SyncClient,
  YjsNoteRepository,
  type LogionOfflineDatabase,
  type JsonObject,
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
  it("retains an encrypted Yjs update on network failure and cleans note state after ACK", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-yjs-sync-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 4,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const stateId = noteDocumentStateId(ids.workspace, ids.entity);
    const document = new Y.Doc();
    document.getText("markdown").insert(0, "before");
    const notePayload = {
      space_id: ids.user,
      task_id: null,
      title: "Encrypted note",
      markdown_body: "before",
    };
    const statePayload = {
      space_id: ids.user,
      note_id: ids.entity,
      note_version: 1,
      yjs_generation: 1,
      state_base64: btoa(
        String.fromCharCode(...Y.encodeStateAsUpdate(document)),
      ),
    };
    await Promise.all([
      vault.put(ids.entity, ids.workspace, notePayload),
      vault.put(stateId, ids.workspace, statePayload),
    ]);
    const baseEntity = {
      workspace_id: ids.workspace,
      server_version: 1,
      local_revision: 0,
      created_at: "2026-07-23T00:00:00Z",
      updated_at: "2026-07-23T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      sync_status: "clean" as const,
    };
    await database.entities.bulkAdd([
      {
        ...baseEntity,
        entity_type: "note",
        entity_id: ids.entity,
        payload: { encrypted_payload_ref: ids.entity },
        payload_hash: await hashPayload(notePayload),
      },
      {
        ...baseEntity,
        entity_type: "note_document_state",
        entity_id: stateId,
        payload: { encrypted_payload_ref: stateId },
        payload_hash: await hashPayload(statePayload),
      },
    ]);
    await new YjsNoteRepository(database, vault).commitMarkdown({
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      device_id: ids.device,
      note_id: ids.entity,
      next_markdown: "after",
      updated_by: ids.user,
      client_occurred_at: "2026-07-23T00:00:01Z",
    });

    const offlineClient = new SyncClient(
      database,
      {
        async push() {
          await Promise.resolve();
          throw new TypeError("network unavailable");
        },
        async pull() {
          await Promise.resolve();
          throw new Error("pull must not run");
        },
      },
      vault,
    );
    await expect(
      offlineClient.synchronize(ids.workspace, ids.device),
    ).rejects.toMatchObject({ code: "OFFLINE_TRANSACTION_FAILED" });
    expect(await database.outbox.get(ids.operation)).toBeDefined();
    expect(
      await database.entities.get([ids.workspace, "note", ids.entity]),
    ).toMatchObject({ sync_status: "pending" });

    let transportedPayload: unknown;
    const result = await new SyncClient(
      database,
      {
        async push(request) {
          await Promise.resolve();
          transportedPayload = request.operations[0].payload;
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
                server_version: 2,
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
            from_cursor: 0,
            next_cursor: 0,
            has_more: false,
            changes: [],
          };
        },
      },
      vault,
    ).synchronize(ids.workspace, ids.device);

    expect(result).toMatchObject({ pushed: 1, pulled: 0 });
    expect(transportedPayload).toMatchObject({
      space_id: ids.user,
      yjs_generation: 1,
    });
    expect(await database.outbox.get(ids.operation)).toBeUndefined();
    expect(
      await database.entities.get([ids.workspace, "note", ids.entity]),
    ).toMatchObject({ server_version: 2, sync_status: "clean" });
    expect(
      await database.entities.get([
        ids.workspace,
        "note_document_state",
        stateId,
      ]),
    ).toMatchObject({ server_version: 2, sync_status: "clean" });
    expect(await vault.get(ids.entity, ids.workspace)).toMatchObject({
      markdown_body: "after",
    });
    expect(await vault.get(stateId, ids.workspace)).toMatchObject({
      note_id: ids.entity,
    });
    const nextOperationId = crypto.randomUUID();
    const nextOperation = await new YjsNoteRepository(
      database,
      vault,
    ).commitMarkdown({
      operation_id: nextOperationId,
      workspace_id: ids.workspace,
      device_id: ids.device,
      note_id: ids.entity,
      next_markdown: "after again",
      updated_by: ids.user,
      client_occurred_at: "2026-07-23T00:00:02Z",
    });
    expect(nextOperation).toMatchObject({
      operation_id: nextOperationId,
      base_version: 2,
      dependencies: [],
    });
    expect(await vault.get(stateId, ids.workspace)).toMatchObject({
      note_version: 2,
    });
  });

  it("pulls update, readable note, and full Yjs state without vault-id collision or false conflict", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-yjs-pull-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 4,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const updateOperationId = crypto.randomUUID();
    const noteOperationId = crypto.randomUUID();
    const stateOperationId = crypto.randomUUID();
    const stateId = noteDocumentStateId(ids.workspace, ids.entity);
    const updatePayload = {
      space_id: ids.user,
      yjs_generation: 1,
      update_base64: "AQ==",
    };
    const notePayload = {
      space_id: ids.user,
      task_id: null,
      title: "Remote note",
      markdown_body: "merged remote body",
    };
    const statePayload = {
      space_id: ids.user,
      note_id: ids.entity,
      note_version: 2,
      yjs_generation: 1,
      state_base64: "AQ==",
    };
    const changes = [
      {
        sequence: 1,
        operation_id: updateOperationId,
        entity_type: "note_document_update",
        entity_id: ids.entity,
        operation_type: "update" as const,
        server_version: 2,
        occurred_at: "2026-07-23T00:00:01Z",
        tombstone: false,
        deleted_at: null,
        payload: updatePayload,
        payload_hash: await hashPayload(updatePayload),
      },
      {
        sequence: 2,
        operation_id: noteOperationId,
        entity_type: "note",
        entity_id: ids.entity,
        operation_type: "update" as const,
        server_version: 2,
        occurred_at: "2026-07-23T00:00:01Z",
        tombstone: false,
        deleted_at: null,
        payload: notePayload,
        payload_hash: await hashPayload(notePayload),
      },
      {
        sequence: 3,
        operation_id: stateOperationId,
        entity_type: "note_document_state",
        entity_id: stateId,
        operation_type: "update" as const,
        server_version: 2,
        occurred_at: "2026-07-23T00:00:01Z",
        tombstone: false,
        deleted_at: null,
        payload: statePayload,
        payload_hash: await hashPayload(statePayload),
      },
    ];

    const result = await new SyncClient(
      database,
      {
        async push() {
          await Promise.resolve();
          throw new Error("push must not run");
        },
        async pull(request) {
          await Promise.resolve();
          return {
            message_type: "pull_response",
            protocol_version: "sync-v1",
            workspace_id: request.workspace_id,
            device_id: request.device_id,
            sync_epoch: request.sync_epoch,
            from_cursor: 0,
            next_cursor: 3,
            has_more: false,
            changes,
          };
        },
      },
      vault,
    ).synchronize(ids.workspace, ids.device);

    expect(result).toMatchObject({ pushed: 0, pulled: 3, control: null });
    expect(await database.conflicts.count()).toBe(0);
    expect(
      await database.entities.get([
        ids.workspace,
        "note_document_update",
        ids.entity,
      ]),
    ).toMatchObject({
      payload: { encrypted_payload_ref: updateOperationId },
      sync_status: "clean",
    });
    expect(
      await database.entities.get([ids.workspace, "note", ids.entity]),
    ).toMatchObject({
      payload: { encrypted_payload_ref: ids.entity },
      sync_status: "clean",
    });
    expect(
      await database.entities.get([
        ids.workspace,
        "note_document_state",
        stateId,
      ]),
    ).toMatchObject({
      payload: { encrypted_payload_ref: stateId },
      sync_status: "clean",
    });
    expect(await vault.get(updateOperationId, ids.workspace)).toEqual(
      updatePayload,
    );
    expect(await vault.get(ids.entity, ids.workspace)).toEqual(notePayload);
    expect(await vault.get(stateId, ids.workspace)).toEqual(statePayload);
    expect(JSON.stringify(await database.entities.toArray())).not.toContain(
      "merged remote body",
    );
  });

  it("keeps pending protected content when a rejected push is followed by a remote pull", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-pending-pull-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 4,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const localPayload = {
      space_id: ids.user,
      task_id: null,
      title: "Local title",
      markdown_body: "local unsent body",
    };
    await new ProtectedOfflineRepository(database, vault).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "note",
      entity_id: ids.entity,
      operation_type: "create",
      base_version: 0,
      local_revision: 1,
      client_occurred_at: "2026-07-23T00:00:00Z",
      created_at: "2026-07-23T00:00:00Z",
      updated_at: "2026-07-23T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: localPayload,
    });
    const remoteOperationId = crypto.randomUUID();
    const remotePayload = {
      ...localPayload,
      title: "Remote title",
      markdown_body: "remote body",
    };

    await new SyncClient(
      database,
      {
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
                status: "rejected",
                retryable: false,
                error_code: "SYNC_OPERATION_INVALID",
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
            from_cursor: 0,
            next_cursor: 1,
            has_more: false,
            changes: [
              {
                sequence: 1,
                operation_id: remoteOperationId,
                entity_type: "note",
                entity_id: ids.entity,
                operation_type: "update",
                server_version: 2,
                occurred_at: "2026-07-23T00:00:01Z",
                tombstone: false,
                deleted_at: null,
                payload: remotePayload,
                payload_hash: await hashPayload(remotePayload),
              },
            ],
          };
        },
      },
      vault,
    ).synchronize(ids.workspace, ids.device);

    expect(await vault.get(ids.operation, ids.workspace)).toEqual(localPayload);
    expect(await vault.get(remoteOperationId, ids.workspace)).toEqual(
      remotePayload,
    );
    expect(
      await database.entities.get([ids.workspace, "note", ids.entity]),
    ).toMatchObject({
      payload: { encrypted_payload_ref: ids.operation },
      sync_status: "conflict",
    });
    expect(await database.outbox.get(ids.operation)).toMatchObject({
      outbox_state: "blocked",
      last_error_code: "SYNC_OPERATION_INVALID",
    });
  });

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

  it("decrypts protected Outbox payloads only for transport", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-protected-sync-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 3,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const protectedPayload = {
      space_id: ids.entity,
      title: "Private learning goal",
      description: "sensitive context",
    };
    await new ProtectedOfflineRepository(database, vault).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "learning_goal",
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
      payload: protectedPayload,
    });
    const unusedTransport: SyncTransport = {
      async push() {
        await Promise.resolve();
        throw new Error("transport must not run");
      },
      async pull() {
        await Promise.resolve();
        throw new Error("transport must not run");
      },
    };
    await expect(
      new SyncClient(database, unusedTransport).synchronize(
        ids.workspace,
        ids.device,
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await database.vaultRecords.delete(ids.operation);
    await expect(
      new SyncClient(database, unusedTransport, vault).synchronize(
        ids.workspace,
        ids.device,
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_TRANSACTION_FAILED" });
    await vault.put(ids.operation, ids.workspace, protectedPayload);
    let transportedPayload: unknown;
    const result = await new SyncClient(
      database,
      {
        async push(request) {
          await Promise.resolve();
          transportedPayload = request.operations[0].payload;
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
            from_cursor: 0,
            next_cursor: 1,
            has_more: false,
            changes: [
              {
                sequence: 1,
                operation_id: ids.operation,
                entity_type: "learning_goal",
                entity_id: ids.entity,
                operation_type: "create",
                server_version: 1,
                occurred_at: "2026-07-21T00:00:01Z",
                tombstone: false,
                deleted_at: null,
                payload: protectedPayload,
                payload_hash: await hashPayload(protectedPayload),
              },
            ],
          };
        },
      },
      vault,
    ).synchronize(ids.workspace, ids.device);
    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(1);
    expect(transportedPayload).toEqual(protectedPayload);
    expect(JSON.stringify(await database.entities.toArray())).not.toContain(
      "sensitive context",
    );
    expect(await vault.get(ids.entity, ids.workspace)).toEqual(
      protectedPayload,
    );
  });

  it("keeps content and verification details out of entity and Outbox rows", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-content-vault-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    const repository = new ProtectedOfflineRepository(database, vault);
    const now = "2026-07-21T00:00:00Z";
    const cases: [
      (
        | "evidence"
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
        | "rubric"
        | "group_review"
        | "group_feedback"
        | "report_snapshot"
        | "audit_review"
        | "mastery"
        | "note"
        | "quiz_attempt"
        | "quiz_item"
        | "resource"
        | "review_finding"
        | "review_schedule"
        | "topic"
        | "topic_dependency"
        | "verification"
      ),
      JsonObject,
    ][] = [
      [
        "note",
        {
          space_id: ids.entity,
          task_id: null,
          title: "Private note",
          markdown_body: "secret markdown body",
        },
      ],
      [
        "resource",
        {
          space_id: ids.entity,
          task_id: null,
          resource_type: "pdf_index",
          title: "Private PDF",
          source_url: null,
          pdf_filename: "paper.pdf",
          page_count: 2,
          sha256: null,
          page_index: [{ page: 1, label: "Method", note: "secret page note" }],
        },
      ],
      [
        "evidence",
        {
          space_id: ids.entity,
          task_id: ids.user,
          evidence_type: "text",
          summary: "secret evidence summary",
        },
      ],
      [
        "verification",
        {
          space_id: ids.entity,
          task_id: ids.user,
          evidence_id: ids.operation,
          action: "decide",
          verdict: "passed",
          reviewer_notes: "secret reviewer note",
        },
      ],
      [
        "topic",
        {
          space_id: ids.entity,
          title: "Private topic",
          description: "secret topic description",
        },
      ],
      [
        "topic_dependency",
        {
          space_id: ids.entity,
          prerequisite_topic_id: ids.user,
          dependent_topic_id: ids.operation,
        },
      ],
      [
        "mastery",
        {
          space_id: ids.entity,
          topic_id: ids.user,
          suggested_level: "practicing",
          suggested_reason: "secret suggestion reason",
          confirmed_level: "exposed",
        },
      ],
      [
        "review_schedule",
        {
          space_id: ids.entity,
          topic_id: ids.user,
          status: "scheduled",
          next_review_at: now,
        },
      ],
      [
        "quiz_item",
        {
          space_id: ids.entity,
          topic_id: ids.user,
          prompt: "secret quiz prompt",
          answer_key: "secret answer key",
          evaluation_mode: "exact_match",
        },
      ],
      [
        "quiz_attempt",
        {
          space_id: ids.entity,
          quiz_item_id: ids.user,
          response_text: "secret attempt response",
          error_cause: "concept_confusion",
        },
      ],
      [
        "error_pattern",
        {
          space_id: ids.entity,
          topic_id: ids.user,
          cause: "secret pattern cause",
          status: "open",
        },
      ],
      [
        "audit_review",
        {
          space_id: ids.entity,
          cadence: "daily",
          summary: "secret audit summary",
        },
      ],
      [
        "review_finding",
        {
          space_id: ids.entity,
          audit_review_id: ids.user,
          description: "secret review finding",
        },
      ],
      [
        "exam",
        {
          space_id: ids.entity,
          title: "secret exam title",
          date_status: "scheduled",
          exam_at: "2026-09-05T01:00:00Z",
          timezone: "Asia/Shanghai",
          target_score: 85,
          score_scale_max: 100,
          status: "planning",
        },
      ],
      [
        "exam_subject",
        {
          space_id: ids.entity,
          exam_id: ids.user,
          name: "secret subject name",
          weight_basis_points: 2500,
          status: "active",
        },
      ],
      [
        "syllabus_node",
        {
          space_id: ids.entity,
          subject_id: ids.user,
          parent_id: null,
          title: "secret syllabus title",
          importance: 5,
          coverage_status: "not_started",
        },
      ],
      [
        "mock_exam",
        {
          space_id: ids.entity,
          exam_id: ids.user,
          title: "secret mock title",
          duration_limit_seconds: 7200,
        },
      ],
      [
        "score_record",
        {
          space_id: ids.entity,
          mock_exam_id: ids.user,
          score: 80,
          score_scale_max: 100,
          duration_seconds: 6900,
          completed_at: now,
        },
      ],
      [
        "learning_track",
        {
          space_id: ids.entity,
          title: "secret track",
          objective: "secret objective",
        },
      ],
      [
        "study_project",
        {
          space_id: ids.entity,
          track_id: ids.user,
          title: "secret project",
          intended_outcome: "secret outcome",
        },
      ],
      [
        "inbox_item",
        {
          space_id: ids.entity,
          title: "secret inbox",
          note: "secret inbox note",
        },
      ],
      [
        "deliverable",
        {
          space_id: ids.entity,
          project_id: ids.user,
          title: "secret deliverable",
          evidence_summary: "secret evidence",
          completed_at: now,
        },
      ],
      [
        "paper_record",
        {
          space_id: ids.entity,
          title: "secret paper",
          citation_key: "secret citation",
          source_url: null,
        },
      ],
      [
        "research_claim",
        {
          space_id: ids.entity,
          paper_id: ids.user,
          statement: "secret claim",
          stance: "supports",
        },
      ],
      [
        "research_question",
        {
          space_id: ids.entity,
          question: "secret question",
          rationale: "secret rationale",
        },
      ],
      [
        "experiment_run",
        {
          space_id: ids.entity,
          question_id: ids.user,
          title: "secret run",
          method_summary: "secret method",
          completed_at: now,
        },
      ],
      [
        "metric_record",
        {
          space_id: ids.entity,
          run_id: ids.user,
          name: "secret metric",
          value: 0.9,
          unit: "score",
        },
      ],
      [
        "research_feedback",
        {
          space_id: ids.entity,
          claim_id: ids.user,
          description: "secret feedback",
          requested_action: "secret action",
        },
      ],
      [
        "rubric",
        {
          space_id: ids.entity,
          title: "secret rubric",
          criteria: "secret criteria",
        },
      ],
      [
        "group_review",
        {
          space_id: ids.entity,
          rubric_id: ids.user,
          subject_title: "secret subject",
          submission_summary: "secret submission",
        },
      ],
      [
        "group_feedback",
        {
          space_id: ids.entity,
          review_id: ids.user,
          feedback: "secret group feedback",
          recommended_action: "secret group action",
        },
      ],
      [
        "report_snapshot",
        {
          space_id: ids.entity,
          review_id: ids.user,
          summary: "secret report summary",
          published_at: now,
        },
      ],
    ];
    for (const [entityType, payload] of cases) {
      await repository.commitMutation({
        operation_id: crypto.randomUUID(),
        protocol_version: "sync-v1",
        workspace_id: ids.workspace,
        device_id: ids.device,
        entity_type: entityType,
        entity_id: crypto.randomUUID(),
        operation_type: "create",
        base_version: 0,
        local_revision: 1,
        client_occurred_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        created_by: ids.user,
        updated_by: ids.user,
        payload,
      });
    }
    const durableRows = JSON.stringify({
      entities: await database.entities.toArray(),
      outbox: await database.outbox.toArray(),
    });
    expect(durableRows).not.toContain("secret markdown body");
    expect(durableRows).not.toContain("secret page note");
    expect(durableRows).not.toContain("secret evidence summary");
    expect(durableRows).not.toContain("secret reviewer note");
    expect(durableRows).not.toContain("secret topic description");
    expect(durableRows).not.toContain("secret suggestion reason");
    expect(durableRows).not.toContain("secret answer key");
    expect(durableRows).not.toContain("secret attempt response");
    expect(durableRows).not.toContain("secret pattern cause");
    expect(durableRows).not.toContain("secret audit summary");
    expect(durableRows).not.toContain("secret review finding");
    expect(durableRows).not.toContain("secret exam title");
    expect(durableRows).not.toContain("2026-09-05T01:00:00Z");
    expect(durableRows).not.toContain('"target_score":85');
    expect(durableRows).not.toContain("secret subject name");
    expect(durableRows).not.toContain("secret syllabus title");
    expect(durableRows).not.toContain("secret mock title");
    expect(durableRows).not.toContain('"duration_seconds":6900');
    expect(durableRows).not.toContain("secret objective");
    expect(durableRows).not.toContain("secret outcome");
    expect(durableRows).not.toContain("secret inbox note");
    expect(durableRows).not.toContain("secret evidence");
    expect(durableRows).not.toContain("secret claim");
    expect(durableRows).not.toContain("secret method");
    expect(durableRows).not.toContain("secret feedback");
    expect(durableRows).not.toContain("secret criteria");
    expect(durableRows).not.toContain("secret submission");
    expect(durableRows).not.toContain("secret group feedback");
    expect(durableRows).not.toContain("secret report summary");
    expect(await database.vaultRecords.count()).toBe(32);
  });

  it("keeps task conflict payloads encrypted while exposing an explicit conflict", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-task-conflict-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await database.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 3,
      sync_epoch: ids.epoch,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const local = {
      space_id: ids.user,
      title: "Local private task",
      description: "local private description",
      status: "in_progress",
      blocked_reason: null,
    };
    await new ProtectedOfflineRepository(database, vault).commitMutation({
      operation_id: ids.operation,
      protocol_version: "sync-v1",
      workspace_id: ids.workspace,
      device_id: ids.device,
      entity_type: "task",
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
      payload: local,
    });
    expect(JSON.stringify(await database.entities.toArray())).not.toContain(
      "local private description",
    );
    expect(JSON.stringify(await database.outbox.toArray())).not.toContain(
      "local private description",
    );
    const remote = {
      space_id: ids.user,
      title: "Sensitive remote task",
      description: "remote private description",
      status: "submitted",
    };
    const remoteHash = await hashPayload(remote);
    await new SyncClient(
      database,
      {
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
                status: "conflict",
                retryable: false,
                conflict: {
                  conflict_id: ids.user,
                  conflict_kind: "status",
                  status: "open",
                  entity_type: "task",
                  entity_id: ids.entity,
                  base_version: 0,
                  local_payload_hash: await hashPayload(local),
                  remote_version: 2,
                  remote_payload: remote,
                  remote_payload_hash: remoteHash,
                  resolution_options: ["keep_remote", "dismiss"],
                  created_at: "2026-07-21T00:00:02Z",
                },
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
            from_cursor: 0,
            next_cursor: 0,
            has_more: false,
            changes: [],
          };
        },
      },
      vault,
    ).synchronize(ids.workspace, ids.device);

    const conflict = await database.conflicts.get(ids.user);
    expect(conflict?.remote_payload).toEqual({
      encrypted_payload_ref: ids.user,
    });
    expect(await vault.get(ids.user, ids.workspace)).toEqual(remote);
    expect(JSON.stringify(await database.conflicts.toArray())).not.toContain(
      "remote private description",
    );
    expect(await database.outbox.get(ids.operation)).toMatchObject({
      outbox_state: "conflict",
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
          next_cursor: 9,
          has_more: false,
          changes: [
            {
              sequence: 9,
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
