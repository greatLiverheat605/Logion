import type { Page } from "@playwright/test";

export async function readLocalSnapshot(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    let databaseName: string | null = null;
    const snapshots: Record<string, Record<string, unknown>[]> = {};
    for (const { name } of databases) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!db.objectStoreNames.contains("attachmentQueue")) {
        db.close();
        continue;
      }
      if (databaseName !== null) {
        db.close();
        throw new Error(
          "Expected one Logion database in this isolated browser context.",
        );
      }
      databaseName = name;
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<Record<string, unknown>[]>(
            (resolve, reject) => {
              const request = db.transaction(store).objectStore(store).getAll();
              request.onsuccess = () =>
                resolve(request.result as Record<string, unknown>[]);
              request.onerror = () => reject(request.error);
            },
          );
          for (const row of rows) {
            if (row.blob instanceof Blob) {
              row.blob = {
                size: row.blob.size,
                type: row.blob.type,
                digest: Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest(
                      "SHA-256",
                      await row.blob.arrayBuffer(),
                    ),
                  ),
                ),
              };
            }
          }
          snapshots[store] = rows;
        }
      } finally {
        db.close();
      }
    }
    if (!databaseName) throw new Error("Logion local database is missing.");
    return { databaseName, stores: snapshots };
  });
}
