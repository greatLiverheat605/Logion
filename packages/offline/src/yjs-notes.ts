import { v5 as uuidv5 } from "uuid";
import * as Y from "yjs";

import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import { hashPayload } from "./hashing";
import type {
  JsonObject,
  LocalEntity,
  OutboxEntry,
  VaultRecord,
} from "./types";
import { validateUuid } from "./validation";
import { OfflineVault } from "./vault";

const UUID_NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
const MAX_MARKDOWN_CHARS = 500_000;
const MAX_UPDATE_BYTES = 180_000;

type NotePayload = JsonObject & {
  space_id: string;
  task_id: string | null;
  title: string;
  markdown_body: string;
};

type NoteDocumentStatePayload = JsonObject & {
  space_id: string;
  note_id: string;
  note_version: number;
  yjs_generation: number;
  state_base64: string;
};

export interface YjsNoteCommitInput {
  operation_id: string;
  workspace_id: string;
  device_id: string;
  note_id: string;
  next_markdown: string;
  updated_by: string;
  client_occurred_at: string;
}

export function noteDocumentStateId(
  workspaceId: string,
  noteId: string,
): string {
  validateUuid(workspaceId);
  validateUuid(noteId);
  return uuidv5(
    `logion:note-document-state:${workspaceId}:${noteId}`,
    UUID_NAMESPACE_URL,
  );
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < value.length; offset += 0x8000) {
    binary += String.fromCharCode(...value.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const decoded = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (encodeBase64(decoded) !== value) throw new Error("non-canonical");
    return decoded;
  } catch {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
}

function replaceMarkdown(text: Y.Text, current: string, next: string): void {
  let prefix = 0;
  while (
    prefix < current.length &&
    prefix < next.length &&
    current[prefix] === next[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = current.length - prefix - suffix;
  const inserted = next.slice(prefix, next.length - suffix);
  if (removed > 0) text.delete(prefix, removed);
  if (inserted.length > 0) text.insert(prefix, inserted);
}

function requireReference(entity: LocalEntity): string {
  const reference = entity.payload.encrypted_payload_ref;
  if (typeof reference !== "string") {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  validateUuid(reference);
  return reference;
}

export class YjsNoteRepository {
  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly vault: OfflineVault,
  ) {}

  async commitMarkdown(input: YjsNoteCommitInput): Promise<OutboxEntry> {
    validateUuid(input.operation_id);
    validateUuid(input.workspace_id);
    validateUuid(input.device_id);
    validateUuid(input.note_id);
    validateUuid(input.updated_by);
    if (input.next_markdown.length > MAX_MARKDOWN_CHARS) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    try {
      const stateId = noteDocumentStateId(input.workspace_id, input.note_id);
      const noteKey: [string, string, string] = [
        input.workspace_id,
        "note",
        input.note_id,
      ];
      const stateKey: [string, string, string] = [
        input.workspace_id,
        "note_document_state",
        stateId,
      ];
      const note = await this.database.entities.get(noteKey);
      const state = await this.database.entities.get(stateKey);
      if (note === undefined || state === undefined) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const noteReference = requireReference(note);
      const stateReference = requireReference(state);
      const notePayload = (await this.vault.get(
        noteReference,
        input.workspace_id,
      )) as NotePayload | null;
      const statePayload = (await this.vault.get(
        stateReference,
        input.workspace_id,
      )) as NoteDocumentStatePayload | null;
      if (
        notePayload === null ||
        statePayload === null ||
        typeof notePayload.space_id !== "string" ||
        typeof notePayload.title !== "string" ||
        typeof notePayload.markdown_body !== "string" ||
        (notePayload.task_id !== null &&
          typeof notePayload.task_id !== "string") ||
        typeof statePayload.space_id !== "string" ||
        typeof statePayload.note_id !== "string" ||
        typeof statePayload.state_base64 !== "string" ||
        statePayload.note_id !== input.note_id ||
        statePayload.space_id !== notePayload.space_id ||
        state.server_version !== note.server_version ||
        !Number.isInteger(statePayload.note_version) ||
        statePayload.note_version < 1 ||
        statePayload.note_version > note.server_version ||
        !Number.isInteger(statePayload.yjs_generation) ||
        statePayload.yjs_generation < 1
      ) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }

      const document = new Y.Doc();
      Y.applyUpdate(document, decodeBase64(statePayload.state_base64));
      const text = document.getText("markdown");
      if (text.toJSON() !== notePayload.markdown_body) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      if (input.next_markdown === notePayload.markdown_body) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const before = Y.encodeStateVector(document);
      replaceMarkdown(text, notePayload.markdown_body, input.next_markdown);
      const update = Y.encodeStateAsUpdate(document, before);
      if (update.length < 1 || update.length > MAX_UPDATE_BYTES) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }

      const operationPayload: JsonObject = {
        space_id: notePayload.space_id,
        yjs_generation: statePayload.yjs_generation,
        update_base64: encodeBase64(update),
      };
      const nextNotePayload: NotePayload = {
        ...notePayload,
        markdown_body: input.next_markdown,
      };
      const nextStatePayload: NoteDocumentStatePayload = {
        ...statePayload,
        note_version: note.server_version,
        state_base64: encodeBase64(Y.encodeStateAsUpdate(document)),
      };
      const [
        operationHash,
        noteHash,
        stateHash,
        sealedOperation,
        sealedNote,
        sealedState,
      ] = await Promise.all([
        hashPayload(operationPayload),
        hashPayload(nextNotePayload),
        hashPayload(nextStatePayload),
        this.vault.seal(
          input.operation_id,
          input.workspace_id,
          operationPayload,
        ),
        this.vault.seal(noteReference, input.workspace_id, nextNotePayload),
        this.vault.seal(stateReference, input.workspace_id, nextStatePayload),
      ]);
      const related = await this.database.outbox
        .where("[workspace_id+entity_type+entity_id]")
        .equals([input.workspace_id, "note_document_update", input.note_id])
        .toArray();
      const predecessor = related
        .sort(
          (left, right) =>
            left.queued_at.localeCompare(right.queued_at) ||
            left.operation_id.localeCompare(right.operation_id),
        )
        .at(-1);
      const operation: OutboxEntry = {
        operation_id: input.operation_id,
        protocol_version: "sync-v1",
        workspace_id: input.workspace_id,
        device_id: input.device_id,
        entity_type: "note_document_update",
        entity_id: input.note_id,
        operation_type: "update",
        base_version: note.server_version,
        client_occurred_at: input.client_occurred_at,
        payload: { encrypted_payload_ref: input.operation_id },
        payload_hash: operationHash,
        payload_vault_id: input.operation_id,
        conflict_resolution: null,
        dependencies: predecessor ? [predecessor.operation_id] : [],
        outbox_state: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error_code: null,
        queued_at: input.client_occurred_at,
      };

      return await this.database.transaction(
        "rw",
        this.database.entities,
        this.database.outbox,
        this.database.vaultRecords,
        async () => {
          if (
            (await this.database.outbox.get(input.operation_id)) !== undefined
          ) {
            throw new OfflineStorageError("OFFLINE_OPERATION_HASH_MISMATCH");
          }
          await this.database.vaultRecords.bulkPut([
            sealedOperation,
            sealedNote,
            sealedState,
          ] as VaultRecord[]);
          await this.database.entities.update(noteKey, {
            local_revision: note.local_revision + 1,
            updated_at: input.client_occurred_at,
            updated_by: input.updated_by,
            payload_hash: noteHash,
            sync_status: "pending",
          });
          await this.database.entities.update(stateKey, {
            local_revision: state.local_revision + 1,
            updated_at: input.client_occurred_at,
            updated_by: input.updated_by,
            payload_hash: stateHash,
            sync_status: "pending",
          });
          await this.database.outbox.add(operation);
          return operation;
        },
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}
