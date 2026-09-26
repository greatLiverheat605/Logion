import {
  clearFormDrafts,
  databaseNameForUser,
  openOfflineDatabase,
} from "@logion/offline";

/**
 * Logout removes this user's sealed form drafts (ADR-0034). No key is needed;
 * a database that was never created is left alone. Failures never block logout.
 */
export async function clearFormDraftsForUser(userId: string): Promise<void> {
  try {
    const name = databaseNameForUser(userId);
    const factory = globalThis.indexedDB ?? null;
    if (factory === null) return;
    if (typeof factory.databases === "function") {
      const existing = await factory.databases();
      if (!existing.some((item) => item.name === name)) return;
    }
    const database = await openOfflineDatabase({
      databaseName: name,
      indexedDB: factory,
      IDBKeyRange: globalThis.IDBKeyRange ?? null,
    });
    try {
      await clearFormDrafts(database);
    } finally {
      database.close();
    }
  } catch {
    // Drafts are ciphertext; logout must still complete.
  }
}
