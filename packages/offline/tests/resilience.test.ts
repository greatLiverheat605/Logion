import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  AttachmentQueueRepository,
  ConflictRepository,
  hashPayload,
  openOfflineDatabase,
  OfflineVault,
  ProtectedOfflineRepository,
  SyncClient,
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
  it("quarantines v3 attachment rows that lack target authorization metadata", async () => {
    const name = `logion-attachment-v3-${crypto.randomUUID()}`;
    const legacy = new Dexie(name, { indexedDB, IDBKeyRange });
    legacy.version(3).stores({
      attachmentQueue:
        "attachment_id, workspace_id, [workspace_id+state+queued_at], [workspace_id+device_id]",
    });
    await legacy.open();
    await legacy.table("attachmentQueue").put({
      attachment_id: ids.attachment,
      workspace_id: ids.workspace,
      device_id: ids.device,
      filename: "legacy.txt",
      media_type: "text/plain",
      byte_size: 6,
      sha256: `sha256:${"a".repeat(64)}`,
      state: "pending_upload",
      blob: new Blob(["legacy"], { type: "text/plain" }),
      queued_at: "2026-07-23T00:00:00Z",
      last_error_code: null,
    });
    legacy.close();

    database = await openOfflineDatabase({
      databaseName: name,
      indexedDB,
      IDBKeyRange,
    });
    expect(await database.attachmentQueue.get(ids.attachment)).toMatchObject({
      state: "failed",
      space_id: null,
      target_type: null,
      target_id: null,
      last_error_code: "OFFLINE_ATTACHMENT_METADATA_REQUIRED",
    });
    await database.attachmentQueue.update(ids.attachment, {
      state: "pending_upload",
    });
    const repository = new AttachmentQueueRepository(database);
    await expect(
      repository.uploadPending(ids.workspace, {} as never),
    ).resolves.toMatchObject({
      state: "failed",
      last_error_code: "OFFLINE_ATTACHMENT_METADATA_REQUIRED",
    });
    await expect(repository.retry(ids.attachment)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
  });

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
      source_operation_id: ids.attachment,
      source_device_id: ids.device,
      resolution_operation_id: null,
      requested_resolution: null,
      server_recorded: true,
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    });
    expect(await repository.listOpen(ids.workspace)).toHaveLength(1);
    const resolutionId = crypto.randomUUID();
    await repository.queueResolution({
      workspace_id: ids.workspace,
      conflict_id: ids.conflict,
      operation_id: resolutionId,
      device_id: ids.device,
      updated_by: ids.user,
      client_occurred_at: "2026-07-21T00:00:03Z",
      resolution: "keep_remote",
    });
    expect(await repository.listOpen(ids.workspace)).toHaveLength(1);
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      payload: remote,
      server_version: 2,
      sync_status: "pending",
    });
    expect(await db.outbox.get(resolutionId)).toMatchObject({
      base_version: 2,
      conflict_resolution: {
        conflict_id: ids.conflict,
        resolution: "keep_remote",
        expected_remote_version: 2,
      },
    });
  });

  it("queues protected conflict resolution without exposing either plaintext version", async () => {
    const db = await open();
    const vault = new OfflineVault(db);
    await vault.initialize(ids.user, "correct horse battery staple");
    const local = {
      space_id: ids.entity,
      task_id: null,
      title: "Local note",
      markdown_body: "local private body",
    };
    const remote = {
      ...local,
      title: "Remote note",
      markdown_body: "remote private body",
    };
    await Promise.all([
      vault.put(ids.attachment, ids.workspace, local),
      vault.put(ids.conflict, ids.workspace, remote),
    ]);
    await db.entities.put({
      workspace_id: ids.workspace,
      entity_type: "note",
      entity_id: ids.entity,
      server_version: 1,
      local_revision: 2,
      created_at: "2026-07-21T00:00:00Z",
      updated_at: "2026-07-21T00:00:01Z",
      deleted_at: null,
      created_by: ids.user,
      updated_by: ids.user,
      payload: { encrypted_payload_ref: ids.attachment },
      payload_hash: await hashPayload(local),
      sync_status: "conflict",
    });
    const conflict = {
      conflict_id: ids.conflict,
      workspace_id: ids.workspace,
      entity_type: "note",
      entity_id: ids.entity,
      status: "open" as const,
      conflict_kind: "content" as const,
      base_version: 1,
      local_payload: { encrypted_payload_ref: ids.attachment },
      local_payload_hash: await hashPayload(local),
      remote_version: 2,
      remote_payload: { encrypted_payload_ref: ids.conflict },
      remote_payload_hash: await hashPayload(remote),
      resolution_options: [
        "keep_local",
        "keep_remote",
        "merge",
        "dismiss",
      ] as const,
      source_operation_id: ids.attachment,
      source_device_id: ids.device,
      resolution_operation_id: null,
      requested_resolution: null,
      server_recorded: true,
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    };
    await new ConflictRepository(db, vault).record({
      ...conflict,
      resolution_options: [...conflict.resolution_options],
    });
    await expect(
      new ConflictRepository(db, vault).queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.user,
        updated_by: ids.user,
        client_occurred_at: "2026-07-21T00:00:03Z",
        resolution: "keep_local",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      new ConflictRepository(db).queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.device,
        updated_by: ids.user,
        client_occurred_at: "2026-07-21T00:00:03Z",
        resolution: "keep_local",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });

    const operationId = crypto.randomUUID();
    const repository = new ConflictRepository(db, vault);
    await repository.queueResolution({
      workspace_id: ids.workspace,
      conflict_id: ids.conflict,
      operation_id: operationId,
      device_id: ids.device,
      updated_by: ids.user,
      client_occurred_at: "2026-07-21T00:00:03Z",
      resolution: "keep_local",
    });
    expect(await vault.get(operationId, ids.workspace)).toEqual(local);
    expect(JSON.stringify(await db.entities.toArray())).not.toContain(
      "private body",
    );
    expect(JSON.stringify(await db.outbox.toArray())).not.toContain(
      "private body",
    );
    expect(await db.outbox.get(operationId)).toMatchObject({
      payload: { encrypted_payload_ref: operationId },
      payload_vault_id: operationId,
      payload_hash: await hashPayload(local),
    });
    expect(await db.conflicts.get(ids.conflict)).toMatchObject({
      status: "resolving",
      requested_resolution: "keep_local",
      resolution_operation_id: operationId,
    });
    await expect(
      repository.queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.device,
        updated_by: ids.user,
        client_occurred_at: "2026-07-21T00:00:04Z",
        resolution: "keep_remote",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });

    await db.syncState.put({
      workspace_id: ids.workspace,
      device_id: ids.device,
      schema_version: 4,
      sync_epoch: ids.user,
      cursor: 0,
      bootstrap_state: "ready",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    let transported: unknown;
    await new SyncClient(
      db,
      {
        async push(request) {
          await Promise.resolve();
          transported = request.operations[0].payload;
          return {
            message_type: "push_response",
            protocol_version: "sync-v1",
            workspace_id: request.workspace_id,
            device_id: request.device_id,
            sync_epoch: request.sync_epoch,
            results: [
              {
                operation_id: operationId,
                status: "applied",
                retryable: false,
                server_version: 3,
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
    expect(transported).toEqual(local);
    expect(await db.outbox.get(operationId)).toBeUndefined();
    expect(await db.conflicts.get(ids.conflict)).toMatchObject({
      status: "resolved_local",
    });
    expect(
      await db.entities.get([ids.workspace, "note", ids.entity]),
    ).toMatchObject({ server_version: 3, sync_status: "clean" });
  });

  it("accepts the remote side of a pull-only conflict without forging a server conflict id", async () => {
    const db = await open();
    const local = { name: "Unsent local" };
    const remote = { name: "Pulled remote" };
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
      sync_status: "conflict",
    });
    const repository = new ConflictRepository(db);
    await repository.record({
      conflict_id: ids.conflict,
      workspace_id: ids.workspace,
      entity_type: "space",
      entity_id: ids.entity,
      status: "open",
      conflict_kind: "status",
      base_version: 1,
      local_payload: local,
      local_payload_hash: await hashPayload(local),
      remote_version: 2,
      remote_payload: remote,
      remote_payload_hash: await hashPayload(remote),
      resolution_options: ["keep_remote", "dismiss"],
      source_operation_id: ids.attachment,
      source_device_id: ids.device,
      resolution_operation_id: null,
      requested_resolution: null,
      server_recorded: false,
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    });
    await expect(
      repository.queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.device,
        updated_by: ids.user,
        client_occurred_at: "2026-07-21T00:00:03Z",
        resolution: "keep_remote",
      }),
    ).resolves.toBeNull();
    expect(await db.outbox.count()).toBe(0);
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      payload: remote,
      server_version: 2,
      sync_status: "clean",
    });
    expect(await db.conflicts.get(ids.conflict)).toMatchObject({
      status: "resolved_remote",
    });
  });

  it("validates attachment path, MIME, extension and size before durable queueing", async () => {
    const db = await open();
    const repository = new AttachmentQueueRepository(db);
    const blob = new Blob(["evidence"], { type: "text/plain" });
    const target = {
      space_id: ids.entity,
      target_type: "note" as const,
      target_id: ids.entity,
    };
    const entry = await repository.enqueue({
      attachment_id: ids.attachment,
      workspace_id: ids.workspace,
      ...target,
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
        ...target,
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
        ...target,
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
        ...target,
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
        ...target,
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
        ...target,
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
        ...target,
        device_id: ids.device,
        filename: "empty.txt",
        media_type: "text/plain",
        blob: new Blob([], { type: "text/plain" }),
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });

  it("drains the attachment queue through init, upload and idempotent complete states", async () => {
    const db = await open();
    const repository = new AttachmentQueueRepository(db);
    await repository.enqueue({
      attachment_id: ids.attachment,
      workspace_id: ids.workspace,
      space_id: ids.entity,
      device_id: ids.device,
      target_type: "note",
      target_id: ids.entity,
      filename: "result.txt",
      media_type: "text/plain",
      blob: new Blob(["evidence"], { type: "text/plain" }),
    });
    const calls: string[] = [];
    const result = await repository.uploadPending(ids.workspace, {
      initiate() {
        calls.push("init");
        return Promise.resolve({ version: 1 });
      },
      upload() {
        calls.push("upload");
        return Promise.resolve({ version: 2 });
      },
      complete(_entry, expectedVersion) {
        calls.push(`complete:${String(expectedVersion)}`);
        return Promise.resolve({ status: "verified", version: 3 });
      },
    });
    expect(calls).toEqual(["init", "upload", "complete:2"]);
    expect(result).toMatchObject({ state: "verified", server_version: 3 });
    expect(
      await repository.uploadPending(ids.workspace, {} as never),
    ).toBeNull();

    await repository.enqueue({
      attachment_id: ids.conflict,
      workspace_id: ids.workspace,
      space_id: ids.entity,
      device_id: ids.device,
      target_type: "note",
      target_id: ids.entity,
      filename: "failed.txt",
      media_type: "text/plain",
      blob: new Blob(["retry"], { type: "text/plain" }),
    });
    const failed = await repository.uploadPending(ids.workspace, {
      initiate() {
        return Promise.resolve({ version: 1 });
      },
      upload() {
        return Promise.reject(new Error("network details must not persist"));
      },
      complete() {
        return Promise.resolve({ status: "verified", version: 3 });
      },
    });
    expect(failed).toMatchObject({
      state: "failed",
      last_error_code: "OFFLINE_ATTACHMENT_UPLOAD_FAILED",
    });
    await repository.retry(ids.conflict);
    expect(await db.attachmentQueue.get(ids.conflict)).toMatchObject({
      state: "pending_upload",
      last_error_code: null,
    });
    await expect(repository.retry(ids.attachment)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await db.attachmentQueue.delete(ids.conflict);

    await repository.enqueue({
      attachment_id: ids.user,
      workspace_id: ids.workspace,
      space_id: ids.entity,
      device_id: ids.device,
      target_type: "note",
      target_id: ids.entity,
      filename: "unverified.txt",
      media_type: "text/plain",
      blob: new Blob(["hold"], { type: "text/plain" }),
    });
    const unverified = await repository.uploadPending(ids.workspace, {
      initiate: () => Promise.resolve({ version: 1 }),
      upload: () => Promise.resolve({ version: 2 }),
      complete: () => Promise.resolve({ status: "uploading", version: 2 }),
    });
    expect(unverified).toMatchObject({
      state: "failed",
      last_error_code: "OFFLINE_ATTACHMENT_VERIFICATION_FAILED",
    });
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

  it("keeps protected entity and Outbox payloads encrypted at rest", async () => {
    const db = await open();
    const vault = new OfflineVault(db);
    await vault.initialize(ids.user, "correct horse battery staple");
    const payload = {
      title: "Private goal",
      description: "sensitive planning context",
      desired_outcome: "private outcome",
    };
    await new ProtectedOfflineRepository(db, vault).commitMutation({
      operation_id: ids.conflict,
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
      payload,
    });
    const entity = await db.entities.get([
      ids.workspace,
      "learning_goal",
      ids.entity,
    ]);
    const operation = await db.outbox.get(ids.conflict);
    expect(entity?.payload).toEqual({ encrypted_payload_ref: ids.conflict });
    expect(operation?.payload).toEqual({ encrypted_payload_ref: ids.conflict });
    expect(operation?.payload_vault_id).toBe(ids.conflict);
    expect(
      JSON.stringify(await db.vaultRecords.get(ids.conflict)),
    ).not.toContain("sensitive planning context");
    expect(await vault.get(ids.conflict, ids.workspace)).toEqual(payload);
    await expect(
      new ProtectedOfflineRepository(db, vault).commitMutation({
        operation_id: ids.conflict,
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
        payload: { ...payload, description: "attacker replacement" },
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_OPERATION_HASH_MISMATCH" });
    expect(await vault.get(ids.conflict, ids.workspace)).toEqual(payload);
    await expect(
      new ProtectedOfflineRepository(db, vault).commitMutation({
        operation_id: ids.attachment,
        protocol_version: "sync-v1",
        workspace_id: ids.workspace,
        device_id: ids.device,
        entity_type: "learning_goal",
        entity_id: ids.attachment,
        operation_type: "update",
        base_version: 1,
        local_revision: 2,
        client_occurred_at: "2026-07-21T00:00:01Z",
        created_at: "2026-07-21T00:00:00Z",
        updated_at: "2026-07-21T00:00:01Z",
        deleted_at: null,
        created_by: ids.user,
        updated_by: ids.user,
        payload,
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    expect(await db.vaultRecords.get(ids.attachment)).toBeUndefined();
  });

  it("rejects invalid conflict transitions without changing the entity", async () => {
    const db = await open();
    const repository = new ConflictRepository(db);
    await expect(
      repository.queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.device,
        updated_by: ids.user,
        client_occurred_at: "not-a-date",
        resolution: "keep_remote",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
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
        source_operation_id: ids.attachment,
        source_device_id: ids.device,
        resolution_operation_id: null,
        requested_resolution: null,
        server_recorded: true,
        created_at: "2026-07-21T00:00:00Z",
        resolved_at: null,
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.queueResolution({
        workspace_id: ids.workspace,
        conflict_id: ids.conflict,
        operation_id: crypto.randomUUID(),
        device_id: ids.device,
        updated_by: ids.user,
        client_occurred_at: "2026-07-21T00:00:00Z",
        resolution: "merge",
        merged_payload: {},
      }),
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
      source_operation_id: ids.attachment,
      source_device_id: ids.device,
      resolution_operation_id: null,
      requested_resolution: null,
      server_recorded: true,
      created_at: "2026-07-21T00:00:01Z",
      resolved_at: null,
    });
    await repository.queueResolution({
      workspace_id: ids.workspace,
      conflict_id: ids.conflict,
      operation_id: crypto.randomUUID(),
      device_id: ids.device,
      updated_by: ids.user,
      client_occurred_at: "2026-07-21T00:00:02Z",
      resolution: "merge",
      merged_payload: { name: "Merged" },
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
      source_operation_id: ids.attachment,
      source_device_id: ids.device,
      resolution_operation_id: null,
      requested_resolution: null,
      server_recorded: true,
      created_at: "2026-07-21T00:00:02Z",
      resolved_at: null,
    });
    await repository.dismiss(ids.workspace, ids.attachment);
    expect(
      await db.entities.get([ids.workspace, "space", ids.entity]),
    ).toMatchObject({
      sync_status: "conflict",
    });
  });
});
