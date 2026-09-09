import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, expect, it } from "vitest";
import * as Y from "yjs";
import * as current from "../src";
import type { PushRequest, PullRequest } from "@logion/contracts";

const legacyRoot = process.env.LOGION_SYNC_COMPAT_DIR;
if (!legacyRoot)
  throw new Error(
    "Run pnpm test:sync-compat to extract the fixed legacy source",
  );
const legacy = (await import(
  `${legacyRoot}/packages/offline/src/index.ts`
)) as typeof current;
const oldContracts = (await import(
  `${legacyRoot}/packages/contracts/src/index.ts`
)) as typeof import("@logion/contracts");
const workspace = "01900000-0000-7000-8000-000000000001";
const device = "01900000-0000-7000-8000-000000000002";
const note = "01900000-0000-7000-8000-000000000003";
const user = "01900000-0000-7000-8000-000000000004";
const epoch = "01900000-0000-7000-8000-000000000005";
const now = "2026-09-09T00:00:00Z";
const password = "synthetic compatibility passphrase";
const control = {
  message_type: "sync_control",
  protocol_version: "sync-v1",
  min_supported_version: "sync-v1",
  action: "upgrade_required",
  reason_code: "PROTOCOL_UNSUPPORTED",
  server_sync_epoch: epoch,
};
let db: current.LogionOfflineDatabase;
let vault: current.OfflineVault;
afterEach(async () => {
  vault.lock();
  db.close();
  await db.delete();
});

async function seed(yjs = false) {
  db = await legacy.openOfflineDatabase({
    databaseName: `legacy-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  vault = new legacy.OfflineVault(db);
  await vault.initialize(user, password);
  await db.syncState.put({
    workspace_id: workspace,
    device_id: device,
    schema_version: 4,
    sync_epoch: epoch,
    cursor: 7,
    bootstrap_state: "ready",
    last_sync_at: null,
    outbox_isolated_at: null,
    isolation_reason_code: null,
  });
  const payload = {
    space_id: user,
    task_id: null,
    title: "Saved note",
    markdown_body: "before",
  };
  await vault.put(note, workspace, payload);
  const entity = {
    workspace_id: workspace,
    entity_type: "note" as const,
    entity_id: note,
    server_version: 1,
    local_revision: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    created_by: user,
    updated_by: user,
    payload: { encrypted_payload_ref: note },
    payload_hash: await legacy.hashPayload(payload),
    sync_status: "clean" as const,
  };
  await db.entities.put(entity);
  const operation = crypto.randomUUID();
  if (yjs) {
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "before");
    const stateId = legacy.noteDocumentStateId(workspace, note);
    const state = {
      space_id: user,
      note_id: note,
      note_version: 1,
      yjs_generation: 1,
      state_base64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))),
    };
    doc.destroy();
    await vault.put(stateId, workspace, state);
    await db.entities.put({
      ...entity,
      entity_type: "note_document_state",
      entity_id: stateId,
      payload: { encrypted_payload_ref: stateId },
      payload_hash: await legacy.hashPayload(state),
    });
    await new legacy.YjsNoteRepository(db, vault).commitMarkdown({
      operation_id: operation,
      workspace_id: workspace,
      device_id: device,
      note_id: note,
      next_markdown: "unsent draft",
      updated_by: user,
      client_occurred_at: now,
    });
  } else {
    await new legacy.ProtectedOfflineRepository(db, vault).commitMutation({
      ...entity,
      operation_id: operation,
      protocol_version: "sync-v1",
      device_id: device,
      operation_type: "update",
      base_version: 1,
      local_revision: 1,
      client_occurred_at: now,
      payload: { ...payload, markdown_body: "unsent draft" },
    });
  }
  return operation;
}

async function contents() {
  return {
    entities: await db.entities.toArray(),
    outbox: await db.outbox.toArray(),
    vault: await db.vaultRecords.toArray(),
    conflicts: await db.conflicts.toArray(),
  };
}

function emptyPull(request: PullRequest) {
  return {
    message_type: "pull_response",
    protocol_version: "sync-v1",
    workspace_id: workspace,
    device_id: device,
    sync_epoch: epoch,
    from_cursor: request.cursor,
    next_cursor: request.cursor,
    has_more: false,
    changes: [],
  };
}
function pushReply(request: PushRequest, results: Record<string, unknown>[]) {
  return {
    message_type: "push_response",
    protocol_version: "sync-v1",
    workspace_id: workspace,
    device_id: device,
    sync_epoch: request.sync_epoch,
    results: results.map((result) => ({
      retryable: false,
      ...(["applied", "duplicate"].includes(result.status as string)
        ? { sequence: 8 }
        : {}),
      ...result,
    })),
  };
}

it.each(["applied", "duplicate", "rejected", "content"])(
  "real legacy client accepts ordinary %s replies",
  async (status) => {
    const operation = await seed();
    const local = await db.entities.get([workspace, "note", note]);
    const result = await new legacy.SyncClient(
      db,
      {
        async push(request) {
          expect(oldContracts.validateSyncV1Message(request).ok).toBe(true);
          const response = pushReply(request, [
            {
              operation_id: operation,
              ...(status === "content"
                ? {
                    status: "conflict",
                    conflict: {
                      conflict_id: crypto.randomUUID(),
                      created_at: now,
                      entity_type: "note",
                      entity_id: note,
                      status: "open",
                      conflict_kind: "content",
                      base_version: 1,
                      remote_version: 2,
                      local_payload_hash: local?.payload_hash,
                      remote_payload: {},
                      remote_payload_hash: await current.hashPayload({}),
                      resolution_options: [
                        "keep_local",
                        "keep_remote",
                        "dismiss",
                      ],
                    },
                  }
                : status === "rejected"
                  ? { status, error_code: "SYNC_OPERATION_UNSUPPORTED" }
                  : { status, server_version: 2 }),
            },
          ]);
          expect(oldContracts.validateSyncV1Message(response).ok).toBe(true);
          return response;
        },
        async pull(request) {
          await Promise.resolve();
          return emptyPull(request);
        },
      },
      vault,
    ).synchronize(workspace, device);
    expect(result.control).toBeNull();
    expect(await db.outbox.count()).toBe(
      ["applied", "duplicate"].includes(status) ? 0 : 1,
    );
  },
);

it.each([
  [false, "push", "keep_remote"],
  [true, "push", "dismiss"],
  [false, "pull", "dismiss"],
  [true, "pull", "keep_remote"],
] as const)(
  "retains real legacy Note/Yjs=%s across %s upgrade, restart and %s",
  async (yjs, route, resolution) => {
    const operation = await seed(yjs);
    if (route === "pull")
      await db.outbox.update(operation, { outbox_state: "blocked" });
    const before = await contents();
    const oldClient = new legacy.SyncClient(
      db,
      {
        async push() {
          await Promise.resolve();
          expect(route).toBe("push");
          return control;
        },
        async pull(request) {
          await Promise.resolve();
          expect(route).toBe("pull");
          expect(request.cursor).toBe(7);
          return control;
        },
      },
      vault,
    );
    expect(oldContracts.validateSyncV1Message(control).ok).toBe(true);
    expect((await oldClient.synchronize(workspace, device)).control).toBe(
      "upgrade_required",
    );
    expect(await contents()).toEqual(before);
    await expect(oldClient.synchronize(workspace, device)).rejects.toThrow();
    await expect(
      new legacy.BootstrapRepository(db, {}, vault).stageChunk(control, {
        workspace_id: workspace,
        device_id: device,
      }),
    ).rejects.toThrow();
    expect(await contents()).toEqual(before);
    const name = db.name;
    vault.lock();
    db.close();
    db = await legacy.openOfflineDatabase({
      databaseName: name,
      indexedDB,
      IDBKeyRange,
    });
    vault = new legacy.OfflineVault(db);
    await vault.unlock(user, password);
    expect(await contents()).toEqual(before);
    const local = await db.entities.get([workspace, "note", note]);
    if (!local) throw new Error("Expected local note");
    const localRef = local.payload.encrypted_payload_ref as string;
    expect(await vault.get(localRef, workspace)).toMatchObject({
      markdown_body: "unsent draft",
    });
    if (yjs) {
      const update = await vault.get(operation, workspace);
      expect(update?.update_base64).toEqual(expect.any(String));
      const stateEntity = await db.entities.get([
        workspace,
        "note_document_state",
        current.noteDocumentStateId(workspace, note),
      ]);
      if (!stateEntity) throw new Error("Expected local Yjs state");
      const state = await vault.get(
        stateEntity.payload.encrypted_payload_ref as string,
        workspace,
      );
      if (!state) throw new Error("Expected encrypted Yjs state");
      const doc = new Y.Doc();
      Y.applyUpdate(
        doc,
        Uint8Array.from(atob(state.state_base64 as string), (c) =>
          c.charCodeAt(0),
        ),
      );
      expect(doc.getText("markdown").toJSON()).toBe("unsent draft");
      doc.destroy();
    }
    expect(JSON.stringify(before)).not.toContain("unsent draft");
    vault.lock();
    db.close();
    db = await current.openOfflineDatabase({
      databaseName: name,
      indexedDB,
      IDBKeyRange,
    });
    vault = new current.OfflineVault(db);
    await vault.unlock(user, password);
    const remoteHash = await current.hashPayload({});
    const conflictId = crypto.randomUUID();
    const result = await new current.SyncClient(
      db,
      {
        async push(request) {
          await Promise.resolve();
          expect(request.operations[0].operation_id).toBe(operation);
          const response = pushReply(request, [
            {
              operation_id: operation,
              status: "conflict",
              conflict: {
                conflict_id: conflictId,
                created_at: now,
                entity_type: "note",
                entity_id: note,
                status: "open",
                conflict_kind: "delete_update",
                base_version: 1,
                remote_version: 2,
                local_payload_hash: local.payload_hash,
                remote_payload: {},
                remote_payload_hash: remoteHash,
                remote_deleted_at: now,
                resolution_options: ["keep_remote", "dismiss"],
              },
            },
          ]);
          expect(oldContracts.validateSyncV1Message(response).ok).toBe(false);
          return response;
        },
        async pull(request) {
          await Promise.resolve();
          expect(request.cursor).toBe(7);
          return {
            ...emptyPull(request),
            next_cursor: 8,
            changes: [
              {
                sequence: 8,
                operation_id: crypto.randomUUID(),
                entity_type: "note",
                entity_id: note,
                operation_type: "delete",
                server_version: 2,
                occurred_at: now,
                tombstone: true,
                deleted_at: now,
                payload: {},
                payload_hash: remoteHash,
              },
            ],
          };
        },
      },
      vault,
    ).synchronize(workspace, device);
    expect(result.control).toBeNull();
    expect(await db.syncState.get(workspace)).toMatchObject({
      bootstrap_state: "ready",
      cursor: 8,
      sync_epoch: epoch,
    });
    expect(await vault.get(localRef, workspace)).toMatchObject({
      markdown_body: "unsent draft",
    });
    const conflicts = new current.ConflictRepository(db, vault);
    const conflict = (await conflicts.listOpen(workspace))[0];
    if (!conflict) throw new Error("Expected a preserved deletion conflict");
    expect(conflict).toMatchObject({
      conflict_kind: "delete_update",
      remote_deleted_at: now,
    });
    expect(await db.outbox.get(operation)).toMatchObject({
      outbox_state: "conflict",
    });
    const resolve = {
      workspace_id: workspace,
      conflict_id: conflict.conflict_id,
      operation_id: crypto.randomUUID(),
      device_id: device,
      updated_by: user,
      client_occurred_at: now,
    };
    await expect(
      conflicts.queueResolution({ ...resolve, resolution: "keep_local" }),
    ).rejects.toThrow();
    if (resolution === "dismiss") {
      await conflicts.dismiss(workspace, conflict.conflict_id);
      expect(await db.outbox.get(operation)).toMatchObject({
        outbox_state: "conflict",
      });
    } else {
      const queued = await conflicts.queueResolution({
        ...resolve,
        resolution,
      });
      if (queued)
        expect(queued).toMatchObject({
          operation_type: "delete",
          conflict_resolution: { resolution },
        });
      expect(await db.entities.get([workspace, "note", note])).toMatchObject({
        deleted_at: now,
      });
    }
    expect(await vault.get(localRef, workspace)).toMatchObject({
      markdown_body: "unsent draft",
    });
  },
);

it.each(["network", "invalid", "upgrade", "workspace", "device", "epoch"])(
  "does not clear upgrade state on %s failure",
  async (failure) => {
    await seed();
    await db.syncState.update(workspace, {
      bootstrap_state: "upgrade_required",
    });
    const before = await contents();
    const client = new current.SyncClient(
      db,
      {
        async push(request) {
          await Promise.resolve();
          if (failure === "network") throw new TypeError("network unavailable");
          if (failure === "invalid") return {};
          if (failure === "upgrade") return control;
          return {
            ...pushReply(
              request,
              request.operations.map((op) => ({
                operation_id: op.operation_id,
                status: "applied",
                server_version: 2,
              })),
            ),
            [failure === "epoch" ? "sync_epoch" : `${failure}_id`]:
              crypto.randomUUID(),
          };
        },
        async pull() {
          await Promise.resolve();
          throw new Error("must not pull");
        },
      },
      vault,
    );
    if (failure === "upgrade")
      expect((await client.synchronize(workspace, device)).control).toBe(
        "upgrade_required",
      );
    else await expect(client.synchronize(workspace, device)).rejects.toThrow();
    expect(await contents()).toEqual(before);
    expect(await db.syncState.get(workspace)).toMatchObject({
      bootstrap_state: "upgrade_required",
      cursor: 7,
    });
  },
);

it("new client resumes original operation against a legacy server response", async () => {
  const operation = await seed();
  await db.syncState.update(workspace, { bootstrap_state: "upgrade_required" });
  await new current.SyncClient(
    db,
    {
      async push(request) {
        await Promise.resolve();
        expect(oldContracts.validateSyncV1Message(request).ok).toBe(true);
        expect(request.operations[0].operation_id).toBe(operation);
        const response = pushReply(request, [
          { operation_id: operation, status: "applied", server_version: 2 },
        ]);
        expect(oldContracts.validateSyncV1Message(response).ok).toBe(true);
        return response;
      },
      async pull(request) {
        await Promise.resolve();
        expect(oldContracts.validateSyncV1Message(request).ok).toBe(true);
        return emptyPull(request);
      },
    },
    vault,
  ).synchronize(workspace, device);
  expect(await db.outbox.count()).toBe(0);
  expect(await db.syncState.get(workspace)).toMatchObject({
    bootstrap_state: "ready",
    cursor: 7,
  });
});

it("shared bootstrap guard preserves resumable states and rejects other contexts", async () => {
  await seed();
  const state = await db.syncState.get(workspace);
  if (!state) throw new Error("Expected initialized device");
  expect(current.canResumeSync(state, device)).toBe(true);
  expect(
    current.canResumeSync(
      { ...state, bootstrap_state: "upgrade_required" },
      device,
    ),
  ).toBe(true);
  for (const bootstrap_state of [
    "staging",
    "rebootstrap_required",
    "empty",
  ] as const) {
    expect(current.canResumeSync({ ...state, bootstrap_state }, device)).toBe(
      false,
    );
  }
  expect(current.canResumeSync({ ...state, sync_epoch: null }, device)).toBe(
    false,
  );
  expect(current.canResumeSync(state, crypto.randomUUID())).toBe(false);
  expect(current.canResumeSync(undefined, device)).toBe(false);
});

it("retains a new deletion refused by the legacy server", async () => {
  await seed();
  await db.outbox.clear();
  const local = await db.entities.get([workspace, "note", note]);
  if (!local) throw new Error("Expected local note");
  const operation = crypto.randomUUID();
  await new current.ProtectedOfflineRepository(db, vault).commitMutation({
    ...local,
    entity_type: "note",
    operation_id: operation,
    protocol_version: "sync-v1",
    device_id: device,
    operation_type: "delete",
    base_version: 1,
    local_revision: 2,
    client_occurred_at: now,
    deleted_at: now,
    payload: {},
  });
  await new current.SyncClient(
    db,
    {
      async push(request) {
        await Promise.resolve();
        expect(oldContracts.validateSyncV1Message(request).ok).toBe(true);
        const response = pushReply(request, [
          {
            operation_id: operation,
            status: "rejected",
            error_code: "SYNC_OPERATION_UNSUPPORTED",
          },
        ]);
        expect(oldContracts.validateSyncV1Message(response).ok).toBe(true);
        return response;
      },
      async pull(request) {
        await Promise.resolve();
        return emptyPull(request);
      },
    },
    vault,
  ).synchronize(workspace, device);
  expect(await db.outbox.get(operation)).toMatchObject({
    outbox_state: "blocked",
    last_error_code: "SYNC_OPERATION_UNSUPPORTED",
  });
  expect(await db.entities.get([workspace, "note", note])).toMatchObject({
    deleted_at: null,
    sync_status: "pending",
  });
  expect(
    await vault.get(local.payload.encrypted_payload_ref as string, workspace),
  ).toMatchObject({ markdown_body: "unsent draft" });
});
