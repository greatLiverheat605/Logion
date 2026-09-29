// R4-8 exception: count-only inspection and explicitly confirmed deletion.
// Never import the legacy vault/Dexie open path: it can upgrade the schema.
function databaseName(userId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      userId,
    )
  )
    throw new Error("无法确认当前账户，未访问本机数据。");
  return `logion-offline-v1-${userId.toLowerCase()}`;
}

export function countLegacyOutbox(userId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let absent = false;
    let blocked = false;
    const request = indexedDB.open(databaseName(userId));
    request.onupgradeneeded = (event) => {
      absent = event.oldVersion === 0;
      request.transaction?.abort();
    };
    request.onerror = () =>
      absent
        ? resolve(0)
        : reject(new Error("无法读取本机旧数据，请检查浏览器存储权限后重试。"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("其他标签页正在操作旧数据，请关闭后重新检查。"));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) {
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.close();
        reject(
          new Error(
            "旧数据库缺少队列，无法确认同步状态。请使用旧版同步入口检查。",
          ),
        );
        return;
      }
      try {
        const transaction = db.transaction("outbox", "readonly");
        const count = transaction.objectStore("outbox").count();
        transaction.oncomplete = () => {
          db.close();
          resolve(count.result);
        };
        transaction.onabort = () => {
          db.close();
          reject(new Error("旧队列检查未完成，请重试。"));
        };
      } catch {
        db.close();
        reject(new Error("旧队列检查未完成，请重试。"));
      }
    };
  });
}

export function clearLegacyData(
  userId: string,
  onBlocked: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(userId));
    // A blocked delete is still pending and cannot be cancelled. Report completion
    // only on success; do not reject and leave a hidden destructive request running.
    request.onblocked = onBlocked;
    request.onerror = () =>
      reject(new Error("清除未完成，请检查浏览器存储权限后重试。"));
    request.onsuccess = () => resolve();
  });
}
