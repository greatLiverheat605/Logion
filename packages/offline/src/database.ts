import Dexie, { type Table } from "dexie";

import { OfflineStorageError, normalizeStorageError } from "./errors";
import {
  OFFLINE_SCHEMA_VERSION,
  type LocalEntity,
  type OfflineDatabaseOptions,
  type OutboxEntry,
  type WorkspaceSyncState,
} from "./types";

export class LogionOfflineDatabase extends Dexie {
  readonly entities!: Table<LocalEntity, [string, string, string]>;
  readonly outbox!: Table<OutboxEntry, string>;
  readonly syncState!: Table<WorkspaceSyncState, string>;

  constructor(options: OfflineDatabaseOptions) {
    if (options.indexedDB === null || options.IDBKeyRange === null) {
      throw new OfflineStorageError("OFFLINE_STORAGE_UNAVAILABLE", true);
    }
    super(options.databaseName, {
      indexedDB: options.indexedDB,
      IDBKeyRange: options.IDBKeyRange,
    });
    this.version(OFFLINE_SCHEMA_VERSION).stores({
      entities:
        "[workspace_id+entity_type+entity_id], workspace_id, [workspace_id+entity_type], [workspace_id+sync_status]",
      outbox:
        "operation_id, workspace_id, [workspace_id+outbox_state+queued_at], [workspace_id+entity_type+entity_id], [workspace_id+device_id]",
      syncState: "workspace_id, device_id, bootstrap_state",
    });
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
