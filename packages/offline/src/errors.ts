export type OfflineErrorCode =
  | "OFFLINE_ATTACHMENT_UPLOAD_FAILED"
  | "OFFLINE_ATTACHMENT_METADATA_REQUIRED"
  | "OFFLINE_ATTACHMENT_VERIFICATION_FAILED"
  | "OFFLINE_BOOTSTRAP_CHUNK_HASH_MISMATCH"
  | "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE"
  | "OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH"
  | "OFFLINE_BOOTSTRAP_DUPLICATE_ENTITY"
  | "OFFLINE_BOOTSTRAP_INVALID"
  | "OFFLINE_BOOTSTRAP_RECORD_HASH_MISMATCH"
  | "OFFLINE_BOOTSTRAP_SNAPSHOT_HASH_MISMATCH"
  | "OFFLINE_DEPENDENCY_CYCLE"
  | "OFFLINE_CRYPTO_UNAVAILABLE"
  | "OFFLINE_INPUT_INVALID"
  | "OFFLINE_OPERATION_HASH_MISMATCH"
  | "OFFLINE_PAYLOAD_TOO_LARGE"
  | "OFFLINE_QUOTA_EXCEEDED"
  | "OFFLINE_SCHEMA_UPGRADE_REQUIRED"
  | "OFFLINE_STORAGE_UNAVAILABLE"
  | "OFFLINE_TRANSACTION_FAILED";

export class OfflineStorageError extends Error {
  readonly code: OfflineErrorCode;
  readonly retryable: boolean;

  constructor(code: OfflineErrorCode, retryable = false, cause?: unknown) {
    super(code, { cause });
    this.name = "OfflineStorageError";
    this.code = code;
    this.retryable = retryable;
  }

  toJSON(): { code: OfflineErrorCode; retryable: boolean } {
    return { code: this.code, retryable: this.retryable };
  }
}

export function normalizeStorageError(error: unknown): OfflineStorageError {
  if (error instanceof OfflineStorageError) return error;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "QuotaExceededError") {
    return new OfflineStorageError("OFFLINE_QUOTA_EXCEEDED", true, error);
  }
  if (name === "VersionError") {
    return new OfflineStorageError(
      "OFFLINE_SCHEMA_UPGRADE_REQUIRED",
      false,
      error,
    );
  }
  return new OfflineStorageError("OFFLINE_TRANSACTION_FAILED", true, error);
}
