import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  OfflineSearchRepository,
  OfflineVault,
  openOfflineDatabase,
  type LocalEntity,
  type LogionOfflineDatabase,
} from "../src";

const ids = {
  encrypted: "01900000-0000-7000-8000-000000000003",
  otherWorkspace: "01900000-0000-7000-8000-000000000004",
  plaintext: "01900000-0000-7000-8000-000000000005",
  user: "01900000-0000-7000-8000-000000000006",
  workspace: "01900000-0000-7000-8000-000000000001",
  workspaceB: "01900000-0000-7000-8000-000000000002",
};

let databases: LogionOfflineDatabase[] = [];

async function open() {
  const database = await openOfflineDatabase({
    databaseName: `logion-search-test-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  databases.push(database);
  return database;
}

function entity(overrides: Partial<LocalEntity>): LocalEntity {
  return {
    workspace_id: ids.workspace,
    entity_type: "task",
    entity_id: ids.plaintext,
    server_version: 1,
    local_revision: 1,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    deleted_at: null,
    created_by: ids.user,
    updated_by: ids.user,
    payload: { title: "Read graph learning paper", description: "baseline" },
    payload_hash: "test-hash",
    sync_status: "clean",
    ...overrides,
  };
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

describe("offline workspace search", () => {
  it("searches only current, supported, non-deleted cached entities", async () => {
    const database = await open();
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await vault.put(ids.encrypted, ids.workspace, {
      title: "Private contrastive learning note",
      markdown_body: "experiment evidence",
    });
    await database.entities.bulkPut([
      entity({}),
      entity({
        entity_id: ids.encrypted,
        entity_type: "note",
        updated_at: "2026-07-21T00:00:00Z",
        payload: { encrypted_payload_ref: ids.encrypted },
      }),
      entity({
        entity_id: ids.otherWorkspace,
        workspace_id: ids.workspaceB,
        payload: { title: "Private other workspace", description: "learning" },
      }),
      entity({
        entity_id: "01900000-0000-7000-8000-000000000007",
        deleted_at: "2026-07-21T00:00:00Z",
        payload: { title: "Deleted learning task" },
      }),
      entity({
        entity_id: "01900000-0000-7000-8000-000000000008",
        entity_type: "audit_review",
        payload: { title: "Unsupported learning record" },
      }),
    ]);

    const results = await new OfflineSearchRepository(database, vault).search(
      ids.workspace,
      "learning",
    );

    expect(results.map((result) => result.entity_id)).toEqual([
      ids.encrypted,
      ids.plaintext,
    ]);
    expect(results[0]?.snippet).toContain("contrastive learning");
  });

  it("requires valid bounds and an unlocked vault for protected matches", async () => {
    const database = await open();
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");
    await vault.put(ids.encrypted, ids.workspace, {
      title: "Encrypted research note",
      markdown_body: "private evidence",
    });
    await database.entities.put(
      entity({
        entity_id: ids.encrypted,
        entity_type: "note",
        payload: { encrypted_payload_ref: ids.encrypted },
      }),
    );
    const repository = new OfflineSearchRepository(database, vault);

    await expect(repository.search(ids.workspace, "x")).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await expect(
      repository.search(ids.workspace, "research", 51),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    vault.lock();
    await expect(
      repository.search(ids.workspace, "research"),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });
});
