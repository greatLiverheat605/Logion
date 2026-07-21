import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  BootstrapRepository,
  hashPayload,
  OfflineRepository,
  OfflineStorageError,
  OfflineVault,
  openOfflineDatabase,
  type JsonObject,
  type LocalEntity,
  type LocalMutationInput,
  type LogionOfflineDatabase,
} from "../src";
import { hashCanonicalJson } from "../src/hashing";

const ids = {
  device: "01900000-0000-7000-8000-000000000002",
  deviceB: "01900000-0000-7000-8000-000000000012",
  entityA: "01900000-0000-7000-8000-000000000004",
  entityB: "01900000-0000-7000-8000-000000000014",
  epochA: "01900000-0000-7000-8000-000000000003",
  epochB: "01900000-0000-7000-8000-000000000013",
  operation: "01900000-0000-7000-8000-000000000005",
  snapshot: "01900000-0000-7000-8000-000000000009",
  user: "01900000-0000-7000-8000-000000000006",
  workspace: "01900000-0000-7000-8000-000000000001",
  workspaceB: "01900000-0000-7000-8000-000000000011",
};

const context = { workspace_id: ids.workspace, device_id: ids.device };
const databases: LogionOfflineDatabase[] = [];
const databaseNames = new Set<string>();

function options(name = `logion-bootstrap-${crypto.randomUUID()}`) {
  databaseNames.add(name);
  return { databaseName: name, indexedDB, IDBKeyRange };
}

async function open(name?: string) {
  const database = await openOfflineDatabase(options(name));
  databases.push(database);
  return database;
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => {
      reject(request.error ?? new Error("test database deletion failed"));
    };
    request.onsuccess = () => {
      resolve();
    };
  });
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all([...databaseNames].map(deleteDatabase));
  databaseNames.clear();
});

async function record(entityId: string, payload: JsonObject, version = 1) {
  return {
    entity_type: "note",
    entity_id: entityId,
    version,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:01:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload,
    payload_hash: await hashPayload(payload),
  };
}

async function messages(
  chunks: Awaited<ReturnType<typeof record>>[][],
  overrides: Record<string, unknown> = {},
) {
  const checksums = await Promise.all(
    chunks.map((records) =>
      hashCanonicalJson(
        records,
        4 * 1024 * 1024,
        "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE",
      ),
    ),
  );
  const snapshotChecksum = await hashCanonicalJson(
    {
      chunks: checksums.map((chunk_checksum, chunk_index) => ({
        chunk_index,
        chunk_checksum,
      })),
    },
    4 * 1024 * 1024,
    "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE",
  );
  return chunks.map((records, chunkIndex) => ({
    message_type: "bootstrap_response",
    protocol_version: "sync-v1",
    min_supported_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    sync_epoch: ids.epochA,
    snapshot_schema_version: 1,
    snapshot_id: ids.snapshot,
    chunk_index: chunkIndex,
    chunk_count: chunks.length,
    cursor: 42,
    snapshot_checksum: snapshotChecksum,
    chunk_checksum: checksums[chunkIndex],
    records,
    created_at: "2026-07-21T00:02:00Z",
    ...overrides,
  }));
}

function oldEntity(syncStatus: LocalEntity["sync_status"] = "clean") {
  return {
    workspace_id: ids.workspace,
    entity_type: "note",
    entity_id: ids.entityA,
    server_version: 1,
    local_revision: syncStatus === "clean" ? 0 : 1,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:01:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload: { markdown: "old readable snapshot" },
    payload_hash: `sha256:${"b".repeat(64)}`,
    sync_status: syncStatus,
  } satisfies LocalEntity;
}

async function putState(
  database: LogionOfflineDatabase,
  syncEpoch = ids.epochA,
) {
  await database.syncState.put({
    workspace_id: ids.workspace,
    device_id: ids.device,
    schema_version: 2,
    sync_epoch: syncEpoch,
    cursor: 1,
    bootstrap_state: "ready",
    last_sync_at: "2026-07-20T00:01:00Z",
    outbox_isolated_at: null,
    isolation_reason_code: null,
  });
}

function mutation(): LocalMutationInput {
  return {
    operation_id: ids.operation,
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    entity_type: "note",
    entity_id: ids.entityA,
    operation_type: "create",
    base_version: 0,
    local_revision: 1,
    client_occurred_at: "2026-07-20T00:01:00Z",
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:01:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload: { markdown: "pending local overlay" },
  };
}

describe("IndexedDB v2 bootstrap staging and atomic activation", () => {
  it("encrypts protected bootstrap payloads before IndexedDB staging", async () => {
    const database = await open();
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    const protectedRecord = {
      ...(await record(ids.entityA, {
        title: "Private goal",
        description: "sensitive bootstrap context",
      })),
      entity_type: "learning_goal",
    };
    const [message] = await messages([[protectedRecord]]);
    expect(message).toBeDefined();
    await expect(
      new BootstrapRepository(database).stageChunk(message, context),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await new BootstrapRepository(database, {}, vault).stageChunk(
      message,
      context,
    );
    const entity = await database.entities.get([
      ids.workspace,
      "learning_goal",
      ids.entityA,
    ]);
    expect(entity?.payload).toEqual({ encrypted_payload_ref: ids.entityA });
    expect(
      JSON.stringify(await database.bootstrapRecords.toArray()),
    ).not.toContain("sensitive bootstrap context");
    expect(await vault.get(ids.entityA, ids.workspace)).toEqual(
      protectedRecord.payload,
    );
  });

  it("upgrades v1 without rewriting its stores or losing readable data", async () => {
    const name = `logion-v1-upgrade-${crypto.randomUUID()}`;
    databaseNames.add(name);
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(1).stores({
      entities:
        "[workspace_id+entity_type+entity_id], workspace_id, [workspace_id+entity_type], [workspace_id+sync_status]",
      outbox:
        "operation_id, workspace_id, [workspace_id+outbox_state+queued_at], [workspace_id+entity_type+entity_id], [workspace_id+device_id]",
      syncState: "workspace_id, device_id, bootstrap_state",
    });
    await legacy.open();
    await legacy.table("entities").put(oldEntity());
    await legacy.table("syncState").put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 1,
      sync_epoch: ids.epochA,
      cursor: 1,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    legacy.close();

    await new Promise<void>((resolve, reject) => {
      const interrupted = indexedDB.open(name, 20);
      interrupted.onupgradeneeded = () => {
        interrupted.transaction?.abort();
      };
      interrupted.onerror = () => {
        if (interrupted.error?.name === "AbortError") resolve();
        else reject(interrupted.error ?? new Error("upgrade abort failed"));
      };
      interrupted.onsuccess = () => {
        interrupted.result.close();
        reject(new Error("interrupted upgrade unexpectedly committed"));
      };
    });

    const upgraded = await open(name);
    expect(await upgraded.entities.count()).toBe(1);
    expect(await upgraded.syncState.get(ids.workspace)).toMatchObject({
      schema_version: 1,
      cursor: 1,
    });
    expect(upgraded.tables.map((table) => table.name).sort()).toEqual([
      "attachmentQueue",
      "bootstrapManifests",
      "bootstrapRecords",
      "conflicts",
      "entities",
      "outbox",
      "syncState",
      "vaultMetadata",
      "vaultRecords",
    ]);
  });

  it("keeps incomplete chunks staged and resumes after reopen", async () => {
    const name = `logion-resume-${crypto.randomUUID()}`;
    const database = await open(name);
    await database.entities.put(oldEntity());
    await putState(database);
    const chunks = await messages([
      [await record(ids.entityA, { markdown: "server A" }, 2)],
      [await record(ids.entityB, { markdown: "server B" })],
    ]);

    await expect(
      new BootstrapRepository(database).stageChunk(chunks[0], context),
    ).resolves.toMatchObject({ complete: false, received_chunks: 1 });
    expect((await database.entities.toArray())[0]?.payload).toEqual({
      markdown: "old readable snapshot",
    });
    database.close();

    const reopened = await open(name);
    await expect(
      new BootstrapRepository(reopened).getProgress(context, ids.snapshot),
    ).resolves.toMatchObject({ complete: false, received_chunks: 1 });
    await expect(
      new BootstrapRepository(reopened).stageChunk(chunks[1], context),
    ).resolves.toMatchObject({ complete: true, received_chunks: 2 });
    expect(await reopened.bootstrapRecords.count()).toBe(0);
    expect(await reopened.entities.count()).toBe(2);
    expect(await reopened.syncState.get(ids.workspace)).toMatchObject({
      cursor: 42,
      sync_epoch: ids.epochA,
      bootstrap_state: "ready",
    });
  });

  it("accepts out-of-order chunks and idempotent replay but rejects changed replay", async () => {
    const database = await open();
    const chunks = await messages([
      [await record(ids.entityA, { markdown: "A" })],
      [await record(ids.entityB, { markdown: "B" })],
    ]);
    const repository = new BootstrapRepository(database);

    await expect(
      repository.stageChunk(chunks[1], context),
    ).resolves.toMatchObject({
      complete: false,
    });
    await expect(
      repository.stageChunk(chunks[1], context),
    ).resolves.toMatchObject({
      received_chunks: 1,
    });
    const changed = await messages([
      [await record(ids.entityA, { markdown: "A" })],
      [await record(ids.entityB, { markdown: "changed" })],
    ]);
    await expect(
      repository.stageChunk(
        {
          ...changed[1],
          snapshot_checksum: chunks[1]?.snapshot_checksum,
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: "OFFLINE_BOOTSTRAP_CHUNK_HASH_MISMATCH",
    });
    await expect(
      repository.stageChunk(chunks[0], context),
    ).resolves.toMatchObject({
      complete: true,
    });
  });

  it("explicitly discards only the matching incomplete snapshot", async () => {
    const database = await open();
    const repository = new BootstrapRepository(database);
    const chunks = await messages([
      [await record(ids.entityA, { markdown: "A" })],
      [await record(ids.entityB, { markdown: "B" })],
    ]);
    await repository.stageChunk(chunks[0], context);

    await expect(
      repository.discardStaging(
        { workspace_id: ids.workspace, device_id: ids.deviceB },
        ids.snapshot,
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH" });
    await expect(
      repository.discardStaging(context, ids.snapshot),
    ).resolves.toBe(true);
    await expect(
      repository.discardStaging(context, ids.snapshot),
    ).resolves.toBe(false);
    await expect(
      repository.getProgress(context, ids.snapshot),
    ).resolves.toBeNull();
    expect(await database.bootstrapRecords.count()).toBe(0);
  });

  it("rejects malformed, cross-context and inconsistent chunk metadata", async () => {
    const database = await open();
    const repository = new BootstrapRepository(database);
    await expect(
      repository.stageChunk({ message_type: "unknown" }, context),
    ).rejects.toMatchObject({
      code: "OFFLINE_BOOTSTRAP_INVALID",
    });
    const chunks = await messages([
      [await record(ids.entityA, { markdown: "A" })],
      [await record(ids.entityB, { markdown: "B" })],
    ]);
    await expect(
      repository.stageChunk(chunks[0], {
        workspace_id: ids.workspaceB,
        device_id: ids.device,
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH" });
    await repository.stageChunk(chunks[0], context);
    await expect(
      repository.stageChunk({ ...chunks[1], cursor: 43 }, context),
    ).rejects.toMatchObject({ code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH" });
    await expect(
      repository.stageChunk({ ...chunks[1], device_id: ids.deviceB }, context),
    ).rejects.toMatchObject({ code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH" });
  });

  it("rejects record, chunk, snapshot and duplicate-entity integrity failures", async () => {
    const recordA = await record(ids.entityA, { markdown: "A" });

    {
      const database = await open();
      const [message] = await messages([
        [
          {
            ...recordA,
            payload_hash: `sha256:${"c".repeat(64)}`,
          },
        ],
      ]);
      await expect(
        new BootstrapRepository(database).stageChunk(message, context),
      ).rejects.toMatchObject({
        code: "OFFLINE_BOOTSTRAP_RECORD_HASH_MISMATCH",
      });
    }
    {
      const database = await open();
      const [message] = await messages([[recordA]]);
      await expect(
        new BootstrapRepository(database).stageChunk(
          { ...message, chunk_checksum: `sha256:${"c".repeat(64)}` },
          context,
        ),
      ).rejects.toMatchObject({
        code: "OFFLINE_BOOTSTRAP_CHUNK_HASH_MISMATCH",
      });
    }
    {
      const database = await open();
      await database.entities.put(oldEntity());
      const chunks = await messages([[recordA], []], {
        snapshot_checksum: `sha256:${"c".repeat(64)}`,
      });
      await new BootstrapRepository(database).stageChunk(chunks[0], context);
      await expect(
        new BootstrapRepository(database).stageChunk(chunks[1], context),
      ).rejects.toMatchObject({
        code: "OFFLINE_BOOTSTRAP_SNAPSHOT_HASH_MISMATCH",
      });
      expect(await database.entities.count()).toBe(1);
      expect(await database.bootstrapRecords.count()).toBe(1);
    }
    {
      const database = await open();
      const duplicate = await messages([[recordA], [recordA]]);
      await new BootstrapRepository(database).stageChunk(duplicate[0], context);
      await expect(
        new BootstrapRepository(database).stageChunk(duplicate[1], context),
      ).rejects.toMatchObject({
        code: "OFFLINE_BOOTSTRAP_DUPLICATE_ENTITY",
      });
    }
    {
      const database = await open();
      const [large] = await messages([
        [await record(ids.entityA, { markdown: "x".repeat(1500) })],
      ]);
      await expect(
        new BootstrapRepository(database, {
          maxSnapshotChunkBytes: 1024,
        }).stageChunk(large, context),
      ).rejects.toMatchObject({
        code: "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE",
      });
    }
  });

  it("rolls back staging and activation quota failures without hiding the old snapshot", async () => {
    const chunks = await messages([
      [await record(ids.entityA, { markdown: "server A" }, 2)],
      [await record(ids.entityB, { markdown: "server B" })],
    ]);
    {
      const database = await open();
      await database.entities.put(oldEntity());
      const fail = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
      database.bootstrapRecords.hook("creating", fail);
      await expect(
        new BootstrapRepository(database).stageChunk(chunks[0], context),
      ).rejects.toMatchObject({ code: "OFFLINE_QUOTA_EXCEEDED" });
      database.bootstrapRecords.hook("creating").unsubscribe(fail);
      expect(await database.bootstrapManifests.count()).toBe(0);
      expect(await database.bootstrapRecords.count()).toBe(0);
      expect((await database.entities.toArray())[0]?.payload).toEqual({
        markdown: "old readable snapshot",
      });
    }
    {
      const database = await open();
      await database.entities.put(oldEntity());
      await new BootstrapRepository(database).stageChunk(chunks[0], context);
      const fail = () => {
        throw new DOMException("full", "QuotaExceededError");
      };
      database.entities.hook("creating", fail);
      await expect(
        new BootstrapRepository(database).stageChunk(chunks[1], context),
      ).rejects.toMatchObject({ code: "OFFLINE_QUOTA_EXCEEDED" });
      database.entities.hook("creating").unsubscribe(fail);
      expect((await database.entities.toArray())[0]?.payload).toEqual({
        markdown: "old readable snapshot",
      });
      expect(await database.bootstrapRecords.count()).toBe(1);
    }
  });

  it("preserves same-epoch local overlays and isolates them on epoch change", async () => {
    const serverRecord = await record(
      ids.entityA,
      { markdown: "server snapshot" },
      2,
    );
    {
      const database = await open();
      await new OfflineRepository(database).commitMutation(mutation());
      await putState(database, ids.epochA);
      const [message] = await messages([[serverRecord]]);
      await new BootstrapRepository(database).stageChunk(message, context);
      expect((await database.entities.toArray())[0]).toMatchObject({
        sync_status: "pending",
        payload: { markdown: "pending local overlay" },
      });
      expect((await database.outbox.toArray())[0]?.outbox_state).toBe(
        "pending",
      );
    }
    {
      const database = await open();
      await new OfflineRepository(database).commitMutation(mutation());
      await putState(database, ids.epochA);
      const [message] = await messages([[serverRecord]], {
        sync_epoch: ids.epochB,
      });
      await new BootstrapRepository(database).stageChunk(message, context);
      expect((await database.entities.toArray())[0]).toMatchObject({
        sync_status: "clean",
        payload: { markdown: "server snapshot" },
      });
      expect((await database.outbox.toArray())[0]).toMatchObject({
        outbox_state: "isolated",
        last_error_code: "SYNC_EPOCH_MISMATCH",
      });
      expect(await database.syncState.get(ids.workspace)).toMatchObject({
        sync_epoch: ids.epochB,
        isolation_reason_code: "SYNC_EPOCH_MISMATCH",
      });
    }
  });

  it("refuses to activate across a foreign-device local queue", async () => {
    const database = await open();
    await new OfflineRepository(database).commitMutation({
      ...mutation(),
      device_id: ids.deviceB,
    });
    await putState(database, ids.epochA);
    const [message] = await messages(
      [[await record(ids.entityA, { markdown: "server" }, 2)]],
      { sync_epoch: ids.epochB },
    );

    await expect(
      new BootstrapRepository(database).stageChunk(message, context),
    ).rejects.toMatchObject({ code: "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH" });
    expect((await database.outbox.toArray())[0]).toMatchObject({
      device_id: ids.deviceB,
      outbox_state: "pending",
    });
    expect((await database.entities.toArray())[0]?.payload).toEqual({
      markdown: "pending local overlay",
    });
  });

  it("leaves every other workspace entity and queue untouched", async () => {
    const database = await open();
    await database.entities.put(oldEntity());
    await putState(database, ids.epochA);
    await new OfflineRepository(database).commitMutation({
      ...mutation(),
      workspace_id: ids.workspaceB,
      entity_id: ids.entityB,
      operation_id: "01900000-0000-7000-8000-000000000015",
    });
    const [message] = await messages(
      [[await record(ids.entityA, { markdown: "new workspace A" }, 2)]],
      { sync_epoch: ids.epochB },
    );

    await new BootstrapRepository(database).stageChunk(message, context);
    expect(
      await database.entities.get([ids.workspaceB, "note", ids.entityB]),
    ).toMatchObject({
      sync_status: "pending",
      payload: { markdown: "pending local overlay" },
    });
    expect(
      await database.outbox.get("01900000-0000-7000-8000-000000000015"),
    ).toMatchObject({
      workspace_id: ids.workspaceB,
      outbox_state: "pending",
    });
  });

  it("fails closed for invalid limits and exposes v2 to the v1 preflight guard", async () => {
    const database = await open();
    expect(
      () => new BootstrapRepository(database, { maxSnapshotChunkBytes: 1 }),
    ).toThrow(OfflineStorageError);
    expect(
      () => new BootstrapRepository(database, { maxOperationBytes: 2_000_000 }),
    ).toThrow(OfflineStorageError);
    const name = database.name;
    database.close();

    const nativeVersion = await new Promise<number>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => {
        reject(request.error ?? new Error("native version read failed"));
      };
      request.onsuccess = () => {
        const version = request.result.version;
        request.result.close();
        resolve(version);
      };
    });
    expect(nativeVersion).toBe(30);
    expect(nativeVersion).toBeGreaterThan(1 * 10);
    const reopened = await open(name);
    expect(reopened.verno).toBe(3);
  });
});
