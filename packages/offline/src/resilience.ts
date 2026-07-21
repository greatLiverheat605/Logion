import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import type {
  AttachmentQueueEntry,
  ConflictStatus,
  JsonObject,
  LocalConflict,
} from "./types";
import { validateUuid } from "./validation";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "text/plain"]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export class ConflictRepository {
  constructor(private readonly database: LogionOfflineDatabase) {}

  async record(conflict: LocalConflict): Promise<void> {
    validateUuid(conflict.conflict_id);
    validateUuid(conflict.workspace_id);
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
    return this.database.conflicts
      .where("[workspace_id+status]")
      .equals([workspaceId, "open"])
      .sortBy("created_at");
  }

  async resolve(
    workspaceId: string,
    conflictId: string,
    resolution: Exclude<ConflictStatus, "open">,
    mergedPayload?: JsonObject,
  ): Promise<void> {
    validateUuid(workspaceId);
    validateUuid(conflictId);
    try {
      await this.database.transaction(
        "rw",
        this.database.conflicts,
        this.database.entities,
        async () => {
          const conflict = await this.database.conflicts.get(conflictId);
          if (
            conflict === undefined ||
            conflict.workspace_id !== workspaceId ||
            conflict.status !== "open"
          ) {
            throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
          }
          const payload =
            resolution === "resolved_remote"
              ? conflict.remote_payload
              : resolution === "resolved_merge"
                ? mergedPayload
                : conflict.local_payload;
          if (payload === undefined) {
            throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
          }
          await this.database.entities.update(
            [workspaceId, conflict.entity_type, conflict.entity_id],
            {
              payload,
              payload_hash:
                resolution === "resolved_remote"
                  ? conflict.remote_payload_hash
                  : conflict.local_payload_hash,
              server_version: conflict.remote_version,
              sync_status: resolution === "dismissed" ? "conflict" : "pending",
            },
          );
          await this.database.conflicts.update(conflictId, {
            status: resolution,
            resolved_at: new Date().toISOString(),
          });
        },
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}

export class AttachmentQueueRepository {
  constructor(private readonly database: LogionOfflineDatabase) {}

  async enqueue(input: {
    attachment_id: string;
    workspace_id: string;
    device_id: string;
    filename: string;
    media_type: string;
    blob: Blob;
  }): Promise<AttachmentQueueEntry> {
    validateUuid(input.attachment_id);
    validateUuid(input.workspace_id);
    validateUuid(input.device_id);
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
    };
    await this.database.attachmentQueue.add(entry);
    return entry;
  }
}
