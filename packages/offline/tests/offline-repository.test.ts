import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  databaseNameForUser,
  hashPayload,
  OfflineRepository,
  OfflineStorageError,
  openOfflineDatabase,
  type LocalMutationInput,
  type LogionOfflineDatabase,
} from "../src";

const ids = {
  device: "01900000-0000-7000-8000-000000000002",
  entityA: "01900000-0000-7000-8000-000000000003",
  entityB: "01900000-0000-7000-8000-000000000004",
  operationA: "01900000-0000-7000-8000-000000000005",
  operationB: "01900000-0000-7000-8000-000000000006",
  user: "01900000-0000-7000-8000-000000000007",
  workspace: "01900000-0000-7000-8000-000000000001",
  workspaceB: "01900000-0000-7000-8000-000000000008",
};

let databases: LogionOfflineDatabase[] = [];

function options(name = `logion-test-${crypto.randomUUID()}`) {
  return { databaseName: name, indexedDB, IDBKeyRange };
}

function mutation(
  overrides: Partial<LocalMutationInput> = {},
): LocalMutationInput {
  return {
    operation_id: ids.operationA,
    protocol_version: "sync-v1",
    workspace_id: ids.workspace,
    device_id: ids.device,
    entity_type: "note",
    entity_id: ids.entityA,
    operation_type: "create",
    base_version: 0,
    local_revision: 1,
    client_occurred_at: "2026-07-21T00:00:00Z",
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload: { markdown: "offline edit" },
    ...overrides,
  };
}

async function open(name?: string) {
  const database = await openOfflineDatabase(options(name));
  databases.push(database);
  return database;
}

afterEach(async () => {
  const current = databases;
  databases = [];
  await Promise.all(
    current.map(async (database) => {
      database.close();
      await database.delete();
    }),
  );
});

describe("IndexedDB v1 and atomic Outbox", () => {
  it("opens a fresh database and preserves records after reopen", async () => {
    const name = `logion-test-${crypto.randomUUID()}`;
    const database = await open(name);
    const repository = new OfflineRepository(database);
    await repository.commitMutation(mutation());
    database.close();

    const reopened = await open(name);
    expect(await reopened.entities.count()).toBe(1);
    expect(await reopened.outbox.count()).toBe(1);
  });

  it("commits the entity and Outbox operation in one transaction", async () => {
    const database = await open();
    const result = await new OfflineRepository(database).commitMutation(
      mutation(),
    );

    expect(result.kind).toBe("committed");
    expect(
      await database.entities.get([ids.workspace, "note", ids.entityA]),
    ).toMatchObject({
      sync_status: "pending",
      payload: { markdown: "offline edit" },
    });
    expect(await database.outbox.get(ids.operationA)).toMatchObject({
      outbox_state: "pending",
      workspace_id: ids.workspace,
      payload_hash: result.operation.payload_hash,
    });
  });

  it("rolls back both writes when the Outbox write aborts", async () => {
    const database = await open();
    const fail = () => {
      throw new DOMException("storage full", "QuotaExceededError");
    };
    database.outbox.hook("creating", fail);

    await expect(
      new OfflineRepository(database).commitMutation(mutation()),
    ).rejects.toMatchObject({ code: "OFFLINE_QUOTA_EXCEEDED" });
    expect(await database.entities.count()).toBe(0);
    expect(await database.outbox.count()).toBe(0);
    database.outbox.hook("creating").unsubscribe(fail);
  });

  it("deduplicates the same operation and rejects hash changes", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await repository.commitMutation(mutation());

    await expect(repository.commitMutation(mutation())).resolves.toMatchObject({
      kind: "duplicate",
    });
    await expect(
      repository.commitMutation(
        mutation({ payload: { markdown: "tampered" } }),
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_OPERATION_HASH_MISMATCH" });
    expect(await database.entities.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
  });

  it("chains later edits to the prior entity operation", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await repository.commitMutation(mutation());
    await repository.commitMutation(
      mutation({
        operation_id: ids.operationB,
        operation_type: "update",
        local_revision: 2,
        updated_at: "2026-07-21T00:01:00Z",
        client_occurred_at: "2026-07-21T00:01:00Z",
        payload: { markdown: "second offline edit" },
      }),
    );

    expect((await database.outbox.get(ids.operationB))?.dependencies).toEqual([
      ids.operationA,
    ]);
    expect(
      (await database.entities.get([ids.workspace, "note", ids.entityA]))
        ?.local_revision,
    ).toBe(2);
    await expect(repository.commitMutation(mutation())).resolves.toMatchObject({
      kind: "duplicate",
    });
  });

  it("rejects invalid identifiers, transitions and delete payloads", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await expect(
      repository.commitMutation(
        mutation({
          operation_id: ids.operationB,
          operation_type: "update",
          base_version: 0,
          local_revision: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.commitMutation(
        mutation({
          operation_id: "not-a-uuid",
          entity_id: ids.entityB,
        }),
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.commitMutation(
        mutation({
          operation_id: "01900000-0000-7000-8000-000000000009",
          entity_id: ids.entityB,
          operation_type: "delete",
          deleted_at: "2026-07-21T00:01:00Z",
          payload: { leaked: "deleted body" },
        }),
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });

  it("keeps workspace queues isolated", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await repository.commitMutation(mutation());
    await repository.commitMutation(
      mutation({
        workspace_id: ids.workspaceB,
        operation_id: ids.operationB,
        entity_id: ids.entityB,
      }),
    );

    expect(
      (await repository.listReadyOperations(ids.workspace, ids.device)).map(
        (item) => item.operation_id,
      ),
    ).toEqual([ids.operationA]);
    expect(
      (await repository.listReadyOperations(ids.workspaceB, ids.device)).map(
        (item) => item.operation_id,
      ),
    ).toEqual([ids.operationB]);
  });

  it("orders dependencies and excludes blocked or isolated operations", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await repository.commitMutation(
      mutation({
        operation_id: ids.operationA,
        entity_id: ids.entityA,
        client_occurred_at: "2026-07-21T00:02:00Z",
      }),
    );
    await repository.commitMutation(
      mutation({
        operation_id: ids.operationB,
        entity_id: ids.entityB,
        client_occurred_at: "2026-07-21T00:01:00Z",
        dependencies: [ids.operationA],
      }),
    );

    expect(
      (await repository.listReadyOperations(ids.workspace, ids.device)).map(
        (item) => item.operation_id,
      ),
    ).toEqual([ids.operationA, ids.operationB]);
    await expect(
      repository.setOperationState(
        ids.workspace,
        ids.device,
        ids.operationA,
        "unknown" as never,
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await repository.setOperationState(
      ids.workspace,
      ids.device,
      ids.operationA,
      "blocked",
      "SYNC_DEPENDENCY_BLOCKED",
    );
    expect(
      await repository.listReadyOperations(ids.workspace, ids.device),
    ).toEqual([]);
    await expect(
      repository.setOperationState(
        ids.workspace,
        ids.device,
        ids.operationA,
        "blocked",
        "raw server error",
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.setOperationState(
        ids.workspaceB,
        ids.device,
        ids.operationA,
        "pending",
      ),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await repository.setOperationState(
      ids.workspace,
      ids.device,
      ids.operationB,
      "isolated",
      "SYNC_EPOCH_MISMATCH",
    );
    expect(
      await repository.listReadyOperations(ids.workspace, ids.device),
    ).toEqual([]);
  });

  it("fails closed when pending dependencies contain a cycle", async () => {
    const database = await open();
    const repository = new OfflineRepository(database);
    await repository.commitMutation(
      mutation({ dependencies: [ids.operationB] }),
    );
    await repository.commitMutation(
      mutation({
        operation_id: ids.operationB,
        entity_id: ids.entityB,
        dependencies: [ids.operationA],
      }),
    );

    await expect(
      repository.listReadyOperations(ids.workspace, ids.device),
    ).rejects.toMatchObject({ code: "OFFLINE_DEPENDENCY_CYCLE" });
  });

  it("maps unavailable and future storage to explicit public errors", async () => {
    await expect(
      openOfflineDatabase({
        databaseName: "unavailable",
        indexedDB: null,
        IDBKeyRange: null,
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_STORAGE_UNAVAILABLE" });

    const name = `logion-future-${crypto.randomUUID()}`;
    const request = indexedDB.open(name, 30);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () =>
        request.result.createObjectStore("future");
      request.onerror = () => {
        reject(request.error ?? new Error("future database open failed"));
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    await expect(openOfflineDatabase(options(name))).rejects.toMatchObject({
      code: "OFFLINE_SCHEMA_UPGRADE_REQUIRED",
    });
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(name);
      deletion.onerror = () => {
        reject(deletion.error ?? new Error("future database delete failed"));
      };
      deletion.onsuccess = () => {
        resolve();
      };
    });
  });

  it("uses a stable non-email database name per user", () => {
    expect(databaseNameForUser(ids.user)).toBe(`logion-offline-v1-${ids.user}`);
    expect(() => databaseNameForUser("learner@example.com")).toThrow(
      OfflineStorageError,
    );
  });

  it("canonicalizes payload hashes and rejects oversized or cyclic data", async () => {
    await expect(hashPayload({ a: 1, b: 2 })).resolves.toBe(
      await hashPayload({ b: 2, a: 1 }),
    );
    await expect(
      hashPayload({ body: "x".repeat(300_000) }),
    ).rejects.toMatchObject({ code: "OFFLINE_PAYLOAD_TOO_LARGE" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(hashPayload(cyclic as never)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
  });
});
