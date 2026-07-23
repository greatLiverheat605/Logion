import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import { hashPayload } from "./hashing";
import { isProtectedEntityType } from "./protected-entities";
import type {
  AttachmentQueueEntry,
  UploadableAttachmentQueueEntry,
  JsonObject,
  LocalConflict,
  OutboxEntry,
} from "./types";
import { validateUuid } from "./validation";
import { OfflineVault } from "./vault";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "text/plain"]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class ConflictRepository {
  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly vault?: OfflineVault,
  ) {}

  async record(conflict: LocalConflict): Promise<void> {
    validateUuid(conflict.conflict_id);
    validateUuid(conflict.workspace_id);
    if (conflict.source_operation_id !== null)
      validateUuid(conflict.source_operation_id);
    if (conflict.source_device_id !== null)
      validateUuid(conflict.source_device_id);
    if (conflict.status !== "open") {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    await this.database.transaction(
      "rw",
      this.database.conflicts,
      this.database.entities,
      async () => {
        await this.database.conflicts.put(conflict);
        await this.database.entities.update(
          [conflict.workspace_id, conflict.entity_type, conflict.entity_id],
          { sync_status: "conflict" },
        );
      },
    );
  }

  async listOpen(workspaceId: string): Promise<LocalConflict[]> {
    validateUuid(workspaceId);
    const rows = await this.database.conflicts
      .where("workspace_id")
      .equals(workspaceId)
      .toArray();
    return rows
      .filter((row) => row.status === "open" || row.status === "resolving")
      .sort(
        (left, right) =>
          left.created_at.localeCompare(right.created_at) ||
          left.conflict_id.localeCompare(right.conflict_id),
      );
  }

  async queueResolution(input: {
    workspace_id: string;
    conflict_id: string;
    operation_id: string;
    device_id: string;
    updated_by: string;
    client_occurred_at: string;
    resolution: "keep_local" | "keep_remote" | "merge";
    merged_payload?: JsonObject;
  }): Promise<OutboxEntry | null> {
    validateUuid(input.workspace_id);
    validateUuid(input.conflict_id);
    validateUuid(input.operation_id);
    validateUuid(input.device_id);
    validateUuid(input.updated_by);
    if (!Number.isFinite(Date.parse(input.client_occurred_at))) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    try {
      const conflict = await this.database.conflicts.get(input.conflict_id);
      if (
        conflict === undefined ||
        conflict.workspace_id !== input.workspace_id ||
        conflict.status !== "open" ||
        !conflict.resolution_options.includes(input.resolution) ||
        conflict.source_operation_id === null ||
        conflict.resolution_operation_id !== null ||
        (conflict.server_recorded &&
          conflict.source_device_id !== input.device_id) ||
        (input.resolution === "merge") !== (input.merged_payload !== undefined)
      ) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const entityKey: [string, string, string] = [
        input.workspace_id,
        conflict.entity_type,
        conflict.entity_id,
      ];
      const sourceOperationId = conflict.source_operation_id;
      const entity = await this.database.entities.get(entityKey);
      if (entity === undefined || entity.sync_status !== "conflict") {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const protectedEntity = isProtectedEntityType(conflict.entity_type);
      const localPayload = protectedEntity
        ? await this.getProtectedPayload(
            conflict.local_payload,
            input.workspace_id,
          )
        : conflict.local_payload;
      const remotePayload = protectedEntity
        ? await this.getProtectedPayload(
            conflict.remote_payload,
            input.workspace_id,
          )
        : conflict.remote_payload;
      if (localPayload === null || remotePayload === null) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const selectedPayload =
        input.resolution === "keep_local"
          ? localPayload
          : input.resolution === "keep_remote"
            ? remotePayload
            : input.merged_payload;
      if (selectedPayload === undefined) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const selectedHash = await hashPayload(selectedPayload);
      if (
        (input.resolution === "keep_local" &&
          selectedHash !== conflict.local_payload_hash) ||
        (input.resolution === "keep_remote" &&
          selectedHash !== conflict.remote_payload_hash)
      ) {
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      }
      const sealed = protectedEntity
        ? await this.requireVault().seal(
            input.operation_id,
            input.workspace_id,
            selectedPayload,
          )
        : null;
      const durablePayload: JsonObject = protectedEntity
        ? { encrypted_payload_ref: input.operation_id }
        : selectedPayload;
      if (!conflict.server_recorded && input.resolution === "keep_remote") {
        await this.database.transaction(
          "rw",
          this.database.conflicts,
          this.database.entities,
          this.database.outbox,
          this.database.vaultRecords,
          async () => {
            if (sealed !== null) {
              await this.database.vaultRecords.put(sealed);
            }
            await this.database.outbox.delete(sourceOperationId);
            await this.database.entities.update(entityKey, {
              payload: durablePayload,
              payload_hash: selectedHash,
              server_version: conflict.remote_version,
              local_revision: entity.local_revision + 1,
              updated_at: input.client_occurred_at,
              updated_by: input.updated_by,
              sync_status: "clean",
            });
            await this.database.conflicts.update(input.conflict_id, {
              status: "resolved_remote",
              requested_resolution: input.resolution,
              resolved_at: input.client_occurred_at,
            });
          },
        );
        return null;
      }
      const operation: OutboxEntry = {
        operation_id: input.operation_id,
        protocol_version: "sync-v1",
        workspace_id: input.workspace_id,
        device_id: input.device_id,
        entity_type: conflict.entity_type,
        entity_id: conflict.entity_id,
        operation_type: "update",
        base_version: conflict.remote_version,
        client_occurred_at: input.client_occurred_at,
        payload: durablePayload,
        payload_hash: selectedHash,
        payload_vault_id: protectedEntity ? input.operation_id : undefined,
        conflict_resolution: conflict.server_recorded
          ? {
              conflict_id: input.conflict_id,
              resolution: input.resolution,
              expected_remote_version: conflict.remote_version,
            }
          : null,
        dependencies: [],
        outbox_state: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error_code: null,
        queued_at: input.client_occurred_at,
      };
      await this.database.transaction(
        "rw",
        this.database.conflicts,
        this.database.entities,
        this.database.outbox,
        this.database.vaultRecords,
        async () => {
          if (
            (await this.database.outbox.get(input.operation_id)) !== undefined
          ) {
            throw new OfflineStorageError("OFFLINE_OPERATION_HASH_MISMATCH");
          }
          if (sealed !== null) {
            await this.database.vaultRecords.put(sealed);
          }
          await this.database.outbox.delete(sourceOperationId);
          await this.database.outbox.add(operation);
          await this.database.entities.update(entityKey, {
            payload: durablePayload,
            payload_hash: selectedHash,
            server_version: conflict.remote_version,
            local_revision: entity.local_revision + 1,
            updated_at: input.client_occurred_at,
            updated_by: input.updated_by,
            sync_status: "pending",
          });
          await this.database.conflicts.update(input.conflict_id, {
            status: "resolving",
            resolution_operation_id: input.operation_id,
            requested_resolution: input.resolution,
          });
        },
      );
      return operation;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async dismiss(workspaceId: string, conflictId: string): Promise<void> {
    validateUuid(workspaceId);
    validateUuid(conflictId);
    const conflict = await this.database.conflicts.get(conflictId);
    if (
      conflict === undefined ||
      conflict.workspace_id !== workspaceId ||
      conflict.status !== "open" ||
      !conflict.resolution_options.includes("dismiss")
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    await this.database.conflicts.update(conflictId, {
      status: "dismissed",
      resolved_at: new Date().toISOString(),
    });
  }

  private requireVault(): OfflineVault {
    if (this.vault === undefined) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    return this.vault;
  }

  private async getProtectedPayload(
    referencePayload: JsonObject,
    workspaceId: string,
  ): Promise<JsonObject | null> {
    const reference = referencePayload.encrypted_payload_ref;
    if (typeof reference !== "string") {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    validateUuid(reference);
    return this.requireVault().get(reference, workspaceId);
  }
}

export class AttachmentQueueRepository {
  constructor(private readonly database: LogionOfflineDatabase) {}

  async enqueue(input: {
    attachment_id: string;
    workspace_id: string;
    space_id: string;
    device_id: string;
    target_type: "note" | "evidence_item" | "experiment_run";
    target_id: string;
    filename: string;
    media_type: string;
    blob: Blob;
  }): Promise<AttachmentQueueEntry> {
    validateUuid(input.attachment_id);
    validateUuid(input.workspace_id);
    validateUuid(input.space_id);
    validateUuid(input.device_id);
    validateUuid(input.target_id);
    const extension = input.filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
    const expectedExtensions: Record<string, string[]> = {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "text/plain": [".txt"],
    };
    if (
      input.filename.includes("/") ||
      input.filename.includes("\\") ||
      !ALLOWED_TYPES.has(input.media_type) ||
      extension === undefined ||
      !expectedExtensions[input.media_type]?.includes(extension) ||
      input.blob.type !== input.media_type ||
      input.blob.size < 1 ||
      input.blob.size > MAX_ATTACHMENT_BYTES
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const header = new Uint8Array(await input.blob.slice(0, 12).arrayBuffer());
    const signatureValid =
      (input.media_type === "image/png" &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
          (value, index) => header[index] === value,
        )) ||
      (input.media_type === "image/jpeg" &&
        header[0] === 0xff &&
        header[1] === 0xd8 &&
        header[2] === 0xff) ||
      (input.media_type === "text/plain" && !header.includes(0));
    if (!signatureValid) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await input.blob.arrayBuffer(),
    );
    const sha256 = `sha256:${Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
    const entry: AttachmentQueueEntry = {
      ...input,
      media_type: input.media_type as AttachmentQueueEntry["media_type"],
      byte_size: input.blob.size,
      sha256,
      state: "pending_upload",
      queued_at: new Date().toISOString(),
      last_error_code: null,
      server_version: null,
    };
    await this.database.attachmentQueue.add(entry);
    return entry;
  }

  async uploadPending(
    workspaceId: string,
    transport: AttachmentUploadTransport,
  ): Promise<AttachmentQueueEntry | null> {
    validateUuid(workspaceId);
    const entry = await this.database.attachmentQueue
      .where("[workspace_id+state+queued_at]")
      .between(
        [workspaceId, "pending_upload", ""],
        [workspaceId, "pending_upload", "\uffff"],
      )
      .first();
    if (entry === undefined) return null;
    if (
      entry.space_id === null ||
      entry.target_id === null ||
      entry.target_type === null
    ) {
      await this.database.attachmentQueue.update(entry.attachment_id, {
        state: "failed",
        last_error_code: "OFFLINE_ATTACHMENT_METADATA_REQUIRED",
      });
      return (
        (await this.database.attachmentQueue.get(entry.attachment_id)) ?? null
      );
    }
    const uploadable = entry as UploadableAttachmentQueueEntry;
    await this.database.attachmentQueue.update(entry.attachment_id, {
      state: "uploading",
      last_error_code: null,
    });
    try {
      await transport.initiate(uploadable);
      const uploaded = await transport.upload(uploadable);
      const completed = await transport.complete(uploadable, uploaded.version);
      if (completed.status !== "verified") {
        throw new OfflineStorageError("OFFLINE_ATTACHMENT_VERIFICATION_FAILED");
      }
      await this.database.attachmentQueue.update(entry.attachment_id, {
        state: "verified",
        server_version: completed.version,
        last_error_code: null,
      });
    } catch (error) {
      const code =
        error instanceof OfflineStorageError
          ? error.code
          : "OFFLINE_ATTACHMENT_UPLOAD_FAILED";
      await this.database.attachmentQueue.update(entry.attachment_id, {
        state: "failed",
        last_error_code: code,
      });
    }
    return (
      (await this.database.attachmentQueue.get(entry.attachment_id)) ?? null
    );
  }

  async retry(attachmentId: string): Promise<void> {
    validateUuid(attachmentId);
    const entry = await this.database.attachmentQueue.get(attachmentId);
    if (
      entry === undefined ||
      entry.state !== "failed" ||
      entry.space_id === null ||
      entry.target_id === null ||
      entry.target_type === null
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    await this.database.attachmentQueue.update(attachmentId, {
      state: "pending_upload",
      last_error_code: null,
    });
  }
}

export interface AttachmentUploadTransport {
  initiate(entry: UploadableAttachmentQueueEntry): Promise<{ version: number }>;
  upload(entry: UploadableAttachmentQueueEntry): Promise<{ version: number }>;
  complete(
    entry: UploadableAttachmentQueueEntry,
    expectedVersion: number,
  ): Promise<{ status: string; version: number }>;
}
