import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  hashPayload,
  noteDocumentStateId,
  OfflineVault,
  openOfflineDatabase,
  YjsNoteRepository,
  type JsonObject,
  type LocalEntity,
  type LogionOfflineDatabase,
} from "../src";

const ids = {
  workspace: "01900000-0000-7000-8000-000000000201",
  device: "01900000-0000-7000-8000-000000000202",
  note: "01900000-0000-7000-8000-000000000203",
  operation: "01900000-0000-7000-8000-000000000204",
  operation2: "01900000-0000-7000-8000-000000000207",
  operation3: "01900000-0000-7000-8000-000000000208",
  user: "01900000-0000-7000-8000-000000000205",
  space: "01900000-0000-7000-8000-000000000206",
};

let database: LogionOfflineDatabase | undefined;

afterEach(async () => {
  database?.close();
  await database?.delete();
  database = undefined;
});

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

describe("encrypted offline Yjs note updates", () => {
  it("derives a stable workspace-scoped state id and rejects invalid ids", () => {
    expect(noteDocumentStateId(ids.workspace, ids.note)).toBe(
      noteDocumentStateId(ids.workspace, ids.note),
    );
    expect(noteDocumentStateId(ids.workspace, ids.note)).not.toBe(ids.note);
    expect(() => noteDocumentStateId("not-a-uuid", ids.note)).toThrow();
    expect(() => noteDocumentStateId(ids.workspace, "not-a-uuid")).toThrow();
  });

  it("atomically queues a bounded update without plaintext in entities or Outbox", async () => {
    database = await openOfflineDatabase({
      databaseName: `logion-yjs-${crypto.randomUUID()}`,
      indexedDB,
      IDBKeyRange,
    });
    const vault = new OfflineVault(database);
    await vault.initialize(ids.user, "correct horse battery staple");

    const document = new Y.Doc();
    document.getText("markdown").insert(0, "first\nsecond");
    const stateId = noteDocumentStateId(ids.workspace, ids.note);
    const notePayload: JsonObject = {
      space_id: ids.space,
      task_id: null,
      title: "Offline document",
      markdown_body: "first\nsecond",
    };
    const statePayload: JsonObject = {
      space_id: ids.space,
      note_id: ids.note,
      note_version: 1,
      yjs_generation: 1,
      state_base64: encode(Y.encodeStateAsUpdate(document)),
    };
    await Promise.all([
      vault.put(ids.note, ids.workspace, notePayload),
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
    const rows: LocalEntity[] = [
      {
        ...baseEntity,
        entity_type: "note",
        entity_id: ids.note,
        payload: { encrypted_payload_ref: ids.note },
        payload_hash: await hashPayload(notePayload),
      },
      {
        ...baseEntity,
        entity_type: "note_document_state",
        entity_id: stateId,
        payload: { encrypted_payload_ref: stateId },
        payload_hash: await hashPayload(statePayload),
      },
    ];
    await database.entities.bulkAdd(rows);

    const operation = await new YjsNoteRepository(
      database,
      vault,
    ).commitMarkdown({
      operation_id: ids.operation,
      workspace_id: ids.workspace,
      device_id: ids.device,
      note_id: ids.note,
      next_markdown: "first-left\nsecond",
      updated_by: ids.user,
      client_occurred_at: "2026-07-23T00:00:01Z",
    });

    expect(operation).toMatchObject({
      entity_type: "note_document_update",
      entity_id: ids.note,
      base_version: 1,
      payload: { encrypted_payload_ref: ids.operation },
      payload_vault_id: ids.operation,
      outbox_state: "pending",
    });
    const transportPayload = await vault.get(ids.operation, ids.workspace);
    expect(transportPayload).toMatchObject({
      space_id: ids.space,
      yjs_generation: 1,
    });
    const encodedUpdate = transportPayload?.update_base64;
    expect(typeof encodedUpdate).toBe("string");
    if (typeof encodedUpdate !== "string") throw new Error("missing update");
    const update = Uint8Array.from(atob(encodedUpdate), (character) =>
      character.charCodeAt(0),
    );
    Y.applyUpdate(document, update);
    expect(document.getText("markdown").toJSON()).toBe("first-left\nsecond");
    const durable = JSON.stringify({
      entities: await database.entities.toArray(),
      outbox: await database.outbox.toArray(),
    });
    expect(durable).not.toContain("first-left");
    expect(durable).not.toContain("state_base64");
    expect(await vault.get(ids.note, ids.workspace)).toMatchObject({
      markdown_body: "first-left\nsecond",
    });
    expect(await database.vaultRecords.get(ids.operation)).toBeDefined();

    const repository = new YjsNoteRepository(database, vault);
    const second = await repository.commitMarkdown({
      operation_id: ids.operation2,
      workspace_id: ids.workspace,
      device_id: ids.device,
      note_id: ids.note,
      next_markdown: "first-left\nsecond-right",
      updated_by: ids.user,
      client_occurred_at: "2026-07-23T00:00:02Z",
    });
    expect(second.dependencies).toEqual([ids.operation]);
    await expect(
      repository.commitMarkdown({
        operation_id: ids.operation3,
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "first-left\nsecond-right",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:03Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "x".repeat(500_001),
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:04Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });

    const stateKey: [string, string, string] = [
      ids.workspace,
      "note_document_state",
      stateId,
    ];
    const stateEntity = await database.entities.get(stateKey);
    await database.entities.delete(stateKey);
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "missing state",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:05Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    if (stateEntity === undefined) throw new Error("missing fixture state");
    await database.entities.put(stateEntity);
    await vault.put(stateId, ids.workspace, {
      ...statePayload,
      state_base64: "not-canonical-base64",
    });
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "invalid state",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:06Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });

    const noteKey: [string, string, string] = [ids.workspace, "note", ids.note];
    const noteEntity = await database.entities.get(noteKey);
    if (noteEntity === undefined) throw new Error("missing fixture note");
    await database.entities.update(noteKey, { payload: {} });
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "missing reference",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:07Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await database.entities.put(noteEntity);
    await database.vaultRecords.delete(ids.note);
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "missing payload",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:08Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
    await vault.put(ids.note, ids.workspace, {
      ...notePayload,
      markdown_body: "first-left\nsecond-right",
    });
    await vault.put(stateId, ids.workspace, {
      ...statePayload,
      yjs_generation: 0,
    });
    await expect(
      repository.commitMarkdown({
        operation_id: crypto.randomUUID(),
        workspace_id: ids.workspace,
        device_id: ids.device,
        note_id: ids.note,
        next_markdown: "invalid generation",
        updated_by: ids.user,
        client_occurred_at: "2026-07-23T00:00:09Z",
      }),
    ).rejects.toMatchObject({ code: "OFFLINE_INPUT_INVALID" });
  });
});
