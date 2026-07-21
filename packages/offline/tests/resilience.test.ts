import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  AttachmentQueueRepository,
  ConflictRepository,
  hashPayload,
  openOfflineDatabase,
  OfflineVault,
  type LogionOfflineDatabase,
} from "../src";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000001",
  device: "01900000-0000-7000-8000-000000000002",
  entity: "01900000-0000-7000-8000-000000000003",
  conflict: "01900000-0000-7000-8000-000000000004",
  attachment: "01900000-0000-7000-8000-000000000005",
  user: "01900000-0000-7000-8000-000000000006",
};

let database: LogionOfflineDatabase | undefined;

afterEach(async () => {
  database?.close();
  await database?.delete();
  database = undefined;
});

async function open() {
  database = await openOfflineDatabase({
    databaseName: `logion-resilience-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  return database;
}

describe("conflict center and attachment queue", () => {
  it("preserves both conflict versions and resolves explicitly", async () => {
    const db = await open();
    const local = { name: "Local" };
    const remote = { name: "Remote" };
    await db.entities.put({
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      server_version: 1,
      local_revision: 2,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:01Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: local,
      payload_hash: await hashPayload(local),
      sync_status: "pending",
    });
    const repository = new ConflictRepository(db);
    await repository.record({
      conflict_id: ids.conflict,
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      status: "open",
      conflict_kind: "content",
      base_version: 1,
      local_payload: local,
      local_payload_hash: await hashPayload(local),
      remote_version: 2,
      remote_payload: remote,
      remote_payload_hash: await hashPayload(remote),
      resolution_options: ["keep_local", "keep_remote", "merge"],
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    });
    expect(await repository.listOpen(ids.workspace)).toHaveLength(1);
    await repository.resolve(ids.workspace, ids.conflict, "resolved_remote");
    expect(await repository.listOpen(ids.workspace)).toHaveLength(0);
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      payload: remote,
      server_version: 2,
      sync_status: "pending",
    });
  });

  it("validates attachment path, MIME, extension and size before durable queueing", async () => {
    const db = await open();
    const repository = new AttachmentQueueRepository(db);
    const blob = new Blob(["evidence"], { type: "text/plain" });
    const entry = await repository.enqueue({
      attachment_id: ids.attachment,
      workspace_id: ids.workspace,
      device_id: ids.device,
      filename: "result.txt",
      media_type: "text/plain",
      blob,
    });
    expect(entry).toMatchObject({ state: "pending_upload", byte_size: 8 });
    expect(entry.sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "../escape.png",
        media_type: "image/png",
        blob: new Blob(["x"], { type: "image/png" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "forged.png",
        media_type: "image/png",
        blob: new Blob(["not png"], { type: "image/png" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "wrong.png",
        media_type: "text/plain",
        blob: new Blob(["x"], { type: "text/plain" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "result.txt",
        media_type: "text/plain",
        blob: new Blob(["x"], { type: "image/png" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "result.exe",
        media_type: "application/octet-stream",
        blob: new Blob(["x"], { type: "application/octet-stream" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.enqueue({
        attachment_id: ids.conflict,
        workspace_id: ids.workspace,
        device_id: ids.device,
        filename: "empty.txt",
        media_type: "text/plain",
        blob: new Blob([], { type: "text/plain" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });

  it("encrypts protected records at rest and drops the key when locked", async () => {
    const db = await open();
    const vault = new OfflineVault(db);
    await expect(
      vault.unlock(ids.user, "not initialized"),
    ).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await expect(vault.initialize(ids.user, "short")).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await vault.initialize(ids.user, "correct horse battery staple");
    await vault.put(ids.entity, ids.workspace, {
      markdown: "private research",
    });
    const stored = await db.vaultRecords.get(ids.entity);
    expect(stored?.ciphertext).not.toContain("private research");
    expect(await vault.get(ids.entity, ids.workspace)).toEqual({
      markdown: "private research",
    });
    vault.lock();
    await expect(vault.get(ids.entity, ids.workspace)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await expect(
      vault.unlock(ids.user, "wrong passphrase"),
    ).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await vault.unlock(ids.user, "correct horse battery staple");
    expect(await vault.get(ids.entity, ids.workspace)).toEqual({
      markdown: "private research",
    });
    expect(await vault.get(ids.attachment, ids.workspace)).toBeNull();
    await expect(vault.get(ids.entity, ids.device)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await expect(
      vault.initialize(ids.user, "correct horse battery staple"),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await vault.wipeLocalData();
    expect(await db.vaultRecords.count()).toBe(0);
    expect(vault.unlocked).toBe(false);
  });

  it("rejects invalid conflict transitions without changing the entity", async () => {
    const db = await open();
    const repository = new ConflictRepository(db);
    await expect(
      repository.record({
        conflict_id: ids.conflict,
        workspace_id: ids.workspace,
        entity_type: "space",
        entity_id: ids.entity,
        status: "dismissed",
        conflict_kind: "content",
        base_version: 1,
        local_payload: {},
        local_payload_hash: await hashPayload({}),
        remote_version: 2,
        remote_payload: {},
        remote_payload_hash: await hashPayload({}),
        resolution_options: ["merge"],
        created_at: "2026-07-21T00:00:00Z",
        resolved_at: null,
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.resolve(ids.workspace, ids.conflict, "resolved_merge"),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await db.entities.put({
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      server_version: 1,
      local_revision: 1,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { name: "Local" },
      payload_hash: await hashPayload({ name: "Local" }),
      sync_status: "pending",
    });
    await repository.record({
      conflict_id: ids.conflict,
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      status: "open",
      conflict_kind: "content",
      base_version: 1,
      local_payload: { name: "Local" },
      local_payload_hash: await hashPayload({ name: "Local" }),
      remote_version: 2,
      remote_payload: { name: "Remote" },
      remote_payload_hash: await hashPayload({ name: "Remote" }),
      resolution_options: ["merge"],
      created_at: "2026-07-21T00:00:01Z",
      resolved_at: null,
    });
    await repository.resolve(ids.workspace, ids.conflict, "resolved_merge", {
      name: "Merged",
    });
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      payload: { name: "Merged" },
    });
    await repository.record({
      conflict_id: ids.attachment,
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      status: "open",
      conflict_kind: "status",
      base_version: 2,
      local_payload: { name: "Merged" },
      local_payload_hash: await hashPayload({ name: "Merged" }),
      remote_version: 3,
      remote_payload: { name: "Remote again" },
      remote_payload_hash: await hashPayload({ name: "Remote again" }),
      resolution_options: ["dismiss"],
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    });
    await repository.resolve(ids.workspace, ids.attachment, "dismissed");
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      sync_status: "conflict",
    });
  });
});
