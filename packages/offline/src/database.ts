import Dexie, { type Table } from "dexie";

import { OfflineStorageError, normalizeStorageError } from "./errors";
import {
  OFFLINE_SCHEMA_VERSION,
  type AttachmentQueueEntry,
  type BootstrapManifest,
  type BootstrapStagedRecord,
  type LocalEntity,
  type LocalConflict,
  type OfflineDatabaseOptions,
  type OutboxEntry,
  type WorkspaceSyncState,
  type VaultMetadata,
  type VaultRecord,
} from "./types";

export class LogionOfflineDatabase extends Dexie {
  readonly entities!: Table<LocalEntity, [string, string, string]>;
  readonly outbox!: Table<OutboxEntry, string>;
  readonly syncState!: Table<WorkspaceSyncState, string>;
  readonly bootstrapManifests!: Table<BootstrapManifest, [string, string]>;
  readonly bootstrapRecords!: Table<
    BootstrapStagedRecord,
    [string, string, number, string, string]
  >;
  readonly conflicts!: Table<LocalConflict, string>;
  readonly attachmentQueue!: Table<AttachmentQueueEntry, string>;
  readonly vaultMetadata!: Table<VaultMetadata, string>;
  readonly vaultRecords!: Table<VaultRecord, string>;

  constructor(options: OfflineDatabaseOptions) {
    if (options.indexedDB === null || options.IDBKeyRange === null) {
      throw new OfflineStorageError("OFFLINE_STORAGE_UNAVAILABLE", true);
    }
    super(options.databaseName, {
      indexedDB: options.indexedDB,
      IDBKeyRange: options.IDBKeyRange,
    });
    this.version(1).stores({
      entities:
        "[workspace_id+entity_type+entity_id], workspace_id, [workspace_id+entity_type], [workspace_id+sync_status]",
      outbox:
        "operation_id, workspace_id, [workspace_id+outbox_state+queued_at], [workspace_id+entity_type+entity_id], [workspace_id+device_id]",
      syncState: "workspace_id, device_id, bootstrap_state",
    });
    this.version(OFFLINE_SCHEMA_VERSION)
      .stores({
        entities:
          "[workspace_id+entity_type+entity_id], workspace_id, [workspace_id+entity_type], [workspace_id+sync_status]",
        outbox:
          "operation_id, workspace_id, [workspace_id+outbox_state+queued_at], [workspace_id+entity_type+entity_id], [workspace_id+device_id]",
        syncState: "workspace_id, device_id, bootstrap_state",
        bootstrapManifests:
          "[workspace_id+snapshot_id], workspace_id, [workspace_id+status]",
        bootstrapRecords:
          "[workspace_id+snapshot_id+chunk_index+entity_type+entity_id], [workspace_id+snapshot_id], [workspace_id+snapshot_id+chunk_index], &[workspace_id+snapshot_id+entity_type+entity_id]",
        conflicts:
          "conflict_id, workspace_id, [workspace_id+status], [workspace_id+entity_type+entity_id]",
        attachmentQueue:
          "attachment_id, workspace_id, [workspace_id+state+queued_at], [workspace_id+device_id]",
        vaultMetadata: "user_id",
        vaultRecords: "record_id, workspace_id",
      })
      .upgrade((transaction) =>
        transaction
          .table<AttachmentQueueEntry, string>("attachmentQueue")
          .toCollection()
          .modify((entry) => {
            if (
              typeof entry.space_id !== "string" ||
              typeof entry.target_id !== "string" ||
              typeof entry.target_type !== "string"
            ) {
              entry.space_id = null;
              entry.target_id = null;
              entry.target_type = null;
              entry.state = "failed";
              entry.last_error_code = "OFFLINE_ATTACHMENT_METADATA_REQUIRED";
              entry.server_version = null;
            }
          }),
      );
  }
}

export async function openOfflineDatabase(
  options: OfflineDatabaseOptions,
): Promise<LogionOfflineDatabase> {
  let database: LogionOfflineDatabase | undefined;
  try {
    if (options.indexedDB === null || options.IDBKeyRange === null) {
      throw new OfflineStorageError("OFFLINE_STORAGE_UNAVAILABLE", true);
    }
    const nativeVersion = await readNativeVersion(
      options.indexedDB,
      options.databaseName,
    );
    if (nativeVersion > OFFLINE_SCHEMA_VERSION * 10) {
      throw new OfflineStorageError("OFFLINE_SCHEMA_UPGRADE_REQUIRED");
    }
    database = new LogionOfflineDatabase(options);
    await database.open();
    if (database.backendDB().version > OFFLINE_SCHEMA_VERSION * 10) {
      throw new OfflineStorageError("OFFLINE_SCHEMA_UPGRADE_REQUIRED");
    }
    return database;
  } catch (error) {
    database?.close();
    throw normalizeStorageError(error);
  }
}

function readNativeVersion(factory: IDBFactory, name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB preflight failed"));
    };
    request.onsuccess = () => {
      const version = request.result.version;
      request.result.close();
      resolve(version);
    };
  });
}
