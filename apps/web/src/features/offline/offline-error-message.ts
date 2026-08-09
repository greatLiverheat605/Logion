import { OfflineStorageError } from "@logion/offline";

export function offlineCapabilityMessage(error: unknown): string | null {
  if (!(error instanceof OfflineStorageError)) return null;
  if (error.code === "OFFLINE_STORAGE_UNAVAILABLE") {
    return "当前浏览器环境无法提供安全本地存储（IndexedDB）。请使用支持 IndexedDB 的现代浏览器，并通过 HTTPS 或 localhost 访问。";
  }
  if (error.code === "OFFLINE_CRYPTO_UNAVAILABLE") {
    return "当前浏览器环境无法提供安全加密与随机数能力（Web Crypto）。请使用支持 Web Crypto 的现代浏览器，并通过 HTTPS 或 localhost 访问。";
  }
  return null;
}

/**
 * The same unlock action is used by several workbenches. Keep its user-facing
 * failure message consistent without weakening the generic storage errors
 * used by save/sync operations.
 */
export function offlineUnlockMessage(error: unknown): string | null {
  const capabilityMessage = offlineCapabilityMessage(error);
  if (capabilityMessage !== null) return capabilityMessage;
  if (
    error instanceof OfflineStorageError &&
    error.code === "OFFLINE_INPUT_INVALID"
  ) {
    return "本地口令不正确，或输入不符合要求。";
  }
  return null;
}
