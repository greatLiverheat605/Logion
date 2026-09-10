import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  ConflictRepository,
  hashPayload,
  noteDocumentStateId,
  OfflineVault,
  openOfflineDatabase,
  ProtectedOfflineRepository,
  SyncClient,
  YjsNoteRepository,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
  type SyncTransport,
} from "../src";

const workspace = crypto.randomUUID();
const device = crypto.randomUUID();
const user = crypto.randomUUID();
const epoch = crypto.randomUUID();
const entityId: string = crypto.randomUUID();
const now = "2026-09-06T00:00:00Z";
let db: LogionOfflineDatabase;
let vault: OfflineVault;

beforeEach(async () => {
  db = await openOfflineDatabase({
    databaseName: `delete-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  vault = new OfflineVault(db);
  await vault.initialize(user, "test deletion passphrase");
  await db.syncState.put({
    workspace_id: workspace,
    device_id: device,
    schema_version: 4,
    sync_epoch: epoch,
    cursor: 0,
    bootstrap_state: "ready",
    last_sync_at: null,
    outbox_isolated_at: null,
    isolation_reason_code: null,
  });
});
afterEach(async () => {
  db.close();
  await db.delete();
});

async function seed(entityType = "note") {
  const payload = {
    space_id: user,
    task_id: null,
    title: "private title",
    markdown_body: "private draft",
  };
  await vault.put(entityId, workspace, payload);
  const entity: LocalEntity = {
    workspace_id: workspace,
    entity_type: entityType,
    entity_id: entityId,
    server_version: 1,
    local_revision: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    created_by: user,
    updated_by: user,
    payload: { encrypted_payload_ref: entityId },
    payload_hash: await hashPayload(payload),
    sync_status: "clean",
  };
  await db.entities.put(entity);
  return entity;
}

async function commit(
  entity: LocalEntity,
  operationType: "delete" | "update" = "delete",
) {
  return new ProtectedOfflineRepository(db, vault).commitMutation({
    ...entity,
    entity_type: entity.entity_type as "note",
    protocol_version: "sync-v1",
    operation_id: crypto.randomUUID(),
    operation_type: operationType,
    device_id: device,
    base_version: entity.server_version,
    local_revision: entity.local_revision + 1,
    client_occurred_at: now,
    deleted_at: operationType === "delete" ? now : null,
    payload:
      operationType === "delete"
        ? {}
        : {
            title: "unsent edit",
            markdown_body: "unsent body",
            space_id: user,
            task_id: null,
          },
  });
}

async function change(sequence: number, tombstone = true, entityType = "note") {
  const payload: JsonObject = tombstone
    ? {}
    : {
        space_id: user,
        task_id: null,
        title: `remote ${String(sequence)}`,
        markdown_body: "remote body",
      };
  return {
    sequence,
    operation_id: crypto.randomUUID(),
    entity_type: entityType,
    entity_id: entityId,
    operation_type: tombstone ? ("delete" as const) : ("update" as const),
    server_version: sequence + 1,
    occurred_at: now,
    tombstone,
    deleted_at: tombstone ? now : null,
    payload,
    payload_hash: await hashPayload(payload),
  };
}

function transport(
  changes: Awaited<ReturnType<typeof change>>[],
  status: "applied" | "rejected" = "applied",
): SyncTransport {
  return {
    push(request) {
      return Promise.resolve({
        protocol_version: "sync-v1",
        workspace_id: workspace,
        device_id: device,
        sync_epoch: epoch,
        message_type: "push_response",
        results: request.operations.map((op) =>
          status === "rejected"
            ? {
                operation_id: op.operation_id,
                status,
                retryable: false,
                error_code: "SYNC_DELETE_BLOCKED_BY_REFERENCE",
                details: { evidence_count: 1, citation_count: 0 },
              }
            : {
                operation_id: op.operation_id,
                status,
                retryable: false,
                server_version: 2,
                sequence: 1,
              },
        ),
      });
    },
    pull(request) {
      const next = changes
        .filter((item) => item.sequence > request.cursor)
        .slice(0, 1);
      const cursor = next[0]?.sequence ?? request.cursor;
      return Promise.resolve({
        message_type: "pull_response",
        protocol_version: "sync-v1",
        workspace_id: workspace,
        device_id: device,
        sync_epoch: epoch,
        from_cursor: request.cursor,
        next_cursor: cursor,
        has_more: changes.some((item) => item.sequence > cursor),
        changes: next,
      });
    },
  };
}

describe("entity deletion", () => {
  it("detects an edit committed while a remote payload is being encrypted", async () => {
    const original = await seed();
    const incoming = await change(1, false);
    const seal = vault.seal.bind(vault);
    let edited = false;
    vi.spyOn(vault, "seal").mockImplementation(async (...args) => {
      if (!edited) {
        edited = true;
        await commit(original, "update");
      }
      return seal(...args);
    });
    await new SyncClient(db, transport([incoming]), vault).synchronize(
      workspace,
      device,
    );
    const conflicts = await new ConflictRepository(db, vault).listOpen(
      workspace,
    );
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    if (!conflict) throw new Error("Expected preserved conflict");
    expect(conflict.source_operation_id).not.toBeNull();
    expect(
      await vault.get(
        conflict.local_payload.encrypted_payload_ref as string,
        workspace,
      ),
    ).toMatchObject({ markdown_body: "unsent body" });
    expect(await vault.get(incoming.operation_id, workspace)).toMatchObject({
      markdown_body: "remote body",
    });
  });

  it("does not restore a deleted Note document from a later projection", async () => {
    await seed();
    const projection = await change(2, false, "note_document_state");
    projection.entity_id = noteDocumentStateId(workspace, entityId);
    projection.payload = { note_id: entityId, state_base64: "AQ==" };
    projection.payload_hash = await hashPayload(projection.payload);
    await new SyncClient(
      db,
      transport([await change(1), projection]),
      vault,
    ).synchronize(workspace, device);
    expect(
      await db.entities.get([
        workspace,
        "note_document_state",
        projection.entity_id,
      ]),
    ).toBeUndefined();
  });

  it("queues an explicit server-recorded deletion resolution with an empty wire payload", async () => {
    const queued = await commit(await seed(), "update");
    const remote = await change(1);
    const conflictId = crypto.randomUUID();
    const api = transport([]);
    api.push = (request) =>
      Promise.resolve({
        message_type: "push_response",
        protocol_version: "sync-v1",
        workspace_id: workspace,
        device_id: device,
        sync_epoch: epoch,
        results: [
          {
            operation_id: request.operations[0].operation_id,
            status: "conflict",
            retryable: false,
            conflict: {
              conflict_id: conflictId,
              entity_type: "note",
              entity_id: entityId,
              status: "open",
              conflict_kind: "delete_update",
              base_version: 1,
              local_payload_hash: request.operations[0].payload_hash,
              remote_version: 2,
              remote_payload: {},
              remote_payload_hash: remote.payload_hash,
              remote_deleted_at: now,
              resolution_options: ["keep_remote", "dismiss"],
              created_at: now,
            },
          },
        ],
      });
    await new SyncClient(db, api, vault).synchronize(workspace, device);
    const resolution = await new ConflictRepository(db, vault).queueResolution({
      workspace_id: workspace,
      conflict_id: conflictId,
      operation_id: crypto.randomUUID(),
      device_id: device,
      updated_by: user,
      client_occurred_at: now,
      resolution: "keep_remote",
    });
    expect(resolution).toMatchObject({
      operation_type: "delete",
      payload: {},
      payload_vault_id: undefined,
      conflict_resolution: {
        conflict_id: conflictId,
        resolution: "keep_remote",
        expected_remote_version: 2,
      },
    });
    expect(
      await vault.get(
        queued.entity.payload.encrypted_payload_ref as string,
        workspace,
      ),
    ).toMatchObject({ markdown_body: "unsent body" });
    await new SyncClient(db, transport([remote]), vault).synchronize(
      workspace,
      device,
    );
    expect(await db.entities.get([workspace, "note", entityId])).toMatchObject({
      deleted_at: now,
      sync_status: "clean",
    });
    expect((await db.conflicts.get(conflictId))?.status).toBe(
      "resolved_remote",
    );
  });
  it.each(["learning_goal", "task", "note"])(
    "queues an empty %s tombstone without erasing encrypted content, including restart",
    async (kind) => {
      const original = await seed(kind);
      const committed = await commit(original);
      expect(committed.operation).toMatchObject({
        payload: {},
        payload_vault_id: undefined,
        base_version: 1,
        outbox_state: "pending",
      });
      expect(committed.entity).toMatchObject({
        deleted_at: now,
        payload: original.payload,
        payload_hash: original.payload_hash,
      });
      expect(JSON.stringify(await db.outbox.toArray())).not.toContain(
        "private draft",
      );
      const name = db.name;
      db.close();
      db = await openOfflineDatabase({
        databaseName: name,
        indexedDB,
        IDBKeyRange,
      });
      vault = new OfflineVault(db);
      await vault.unlock(user, "test deletion passphrase");
      expect(
        await db.outbox.get(committed.operation.operation_id),
      ).toMatchObject({ payload: {}, outbox_state: "pending" });
      expect(await vault.get(entityId, workspace)).toMatchObject({
        markdown_body: "private draft",
      });
    },
  );

  it("rejects invalid delete input and refuses a second delete or unresolved conflict", async () => {
    const original = await seed();
    const deleted = await commit(original);
    await expect(commit(deleted.entity)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
    await db.entities.update([workspace, "note", entityId], {
      deleted_at: null,
      sync_status: "conflict",
    });
    await expect(
      commit({ ...deleted.entity, deleted_at: null }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });

  it("preserves blocked work instead of placing a delete behind it", async () => {
    const first = await commit(await seed(), "update");
    await db.outbox.update(first.operation.operation_id, {
      outbox_state: "blocked",
    });
    await expect(commit(first.entity)).rejects.toMatchObject({
      code: "OFFLINE_INPUT_INVALID",
    });
  });

  it("restores visibility on non-retryable reference refusal without claiming a clean ACK", async () => {
    const queued = await commit(await seed());
    await new SyncClient(db, transport([], "rejected"), vault).synchronize(
      workspace,
      device,
    );
    expect(await db.outbox.get(queued.operation.operation_id)).toMatchObject({
      outbox_state: "blocked",
      last_error_code: "SYNC_DELETE_BLOCKED_BY_REFERENCE",
    });
    expect(await db.entities.get([workspace, "note", entityId])).toMatchObject({
      deleted_at: null,
      sync_status: "pending",
      payload: queued.entity.payload,
    });
  });

  it("applies clean tombstones and invalidates document projections", async () => {
    const original = await seed();
    await db.entities.put({
      ...original,
      entity_type: "note_document_state",
      entity_id: noteDocumentStateId(workspace, entityId),
    });
    await new SyncClient(db, transport([await change(1)]), vault).synchronize(
      workspace,
      device,
    );
    expect(await db.entities.get([workspace, "note", entityId])).toMatchObject({
      deleted_at: now,
      sync_status: "clean",
      payload: {},
    });
    expect(
      await db.entities.get([
        workspace,
        "note_document_state",
        noteDocumentStateId(workspace, entityId),
      ]),
    ).toBeUndefined();
  });

  it.each([true, false])(
    "preserves unresolved work across multiple pull pages, remote deletion=%s",
    async (tombstone) => {
      const queued = await commit(
        await seed(),
        tombstone ? "update" : "delete",
      );
      await db.outbox.update(queued.operation.operation_id, {
        outbox_state: "blocked",
      });
      await new SyncClient(
        db,
        transport([await change(1, tombstone), await change(2, true)]),
        vault,
      ).synchronize(workspace, device);
      const conflict = (
        await new ConflictRepository(db, vault).listOpen(workspace)
      )[0];
      if (!conflict) throw new Error("Expected preserved conflict");
      expect(conflict).toMatchObject({
        conflict_kind: "delete_update",
        local_payload: queued.entity.payload,
      });
      expect(await db.outbox.get(queued.operation.operation_id)).toMatchObject({
        outbox_state: "conflict",
      });
      expect(
        await db.entities.get([workspace, "note", entityId]),
      ).toMatchObject({
        sync_status: "conflict",
        payload: queued.entity.payload,
      });
      // A later tombstone updates the remote side, never the encrypted local draft.
      expect(conflict.remote_deleted_at).toBe(now);
      expect(conflict.remote_version).toBe(3);
      await expect(
        new ConflictRepository(db, vault).queueResolution({
          workspace_id: workspace,
          conflict_id: conflict.conflict_id,
          operation_id: crypto.randomUUID(),
          device_id: device,
          updated_by: user,
          client_occurred_at: now,
          resolution: "keep_local",
        }),
      ).rejects.toThrow();
      await new ConflictRepository(db, vault).queueResolution({
        workspace_id: workspace,
        conflict_id: conflict.conflict_id,
        operation_id: crypto.randomUUID(),
        device_id: device,
        updated_by: user,
        client_occurred_at: now,
        resolution: "keep_remote",
      });
      expect(
        await db.entities.get([workspace, "note", entityId]),
      ).toMatchObject({ deleted_at: now, sync_status: "clean" });
      expect(await db.outbox.count()).toBe(0);
      expect(
        await vault.get(
          queued.entity.payload.encrypted_payload_ref as string,
          workspace,
        ),
      ).not.toBeNull();
    },
  );

  it("keeps unsent Yjs text as a manual deletion conflict and prevents editing a deleted identity", async () => {
    const note = await seed();
    const stateId = noteDocumentStateId(workspace, entityId);
    const doc = new Y.Doc();
    doc.getText("markdown").insert(0, "private draft");
    const payload = {
      space_id: user,
      note_id: entityId,
      note_version: 1,
      yjs_generation: 1,
      state_base64: btoa(String.fromCharCode(...Y.encodeStateAsUpdate(doc))),
    };
    await vault.put(stateId, workspace, payload);
    await db.entities.put({
      ...note,
      entity_type: "note_document_state",
      entity_id: stateId,
      payload: { encrypted_payload_ref: stateId },
      payload_hash: await hashPayload(payload),
    });
    const input = {
      operation_id: crypto.randomUUID(),
      workspace_id: workspace,
      device_id: device,
      note_id: entityId,
      next_markdown: "unsent Yjs body",
      updated_by: user,
      client_occurred_at: now,
    };
    const op = await new YjsNoteRepository(db, vault).commitMarkdown(input);
    await db.outbox.update(op.operation_id, { outbox_state: "blocked" });
    await new SyncClient(db, transport([await change(1)]), vault).synchronize(
      workspace,
      device,
    );
    expect(await db.outbox.get(op.operation_id)).toMatchObject({
      outbox_state: "conflict",
    });
    expect(await vault.get(entityId, workspace)).toMatchObject({
      markdown_body: "unsent Yjs body",
    });
    await expect(
      new YjsNoteRepository(db, vault).commitMarkdown({
        ...input,
        operation_id: crypto.randomUUID(),
        next_markdown: "resurrection",
      }),
    ).rejects.toThrow();
  });
});
