import { canonicalize } from "json-canonicalize";

import { OfflineStorageError } from "./errors";
import { DEFAULT_MAX_OPERATION_BYTES, validatePayload } from "./validation";
import type { OfflineErrorCode } from "./errors";
import type { JsonObject } from "./types";

const encoder = new TextEncoder();

function defaultSubtleCrypto(): SubtleCrypto | null {
  const runtime = globalThis as unknown as { crypto?: Crypto };
  return runtime.crypto?.subtle ?? null;
}

export const MAX_CANONICAL_JSON_BYTES = 16 * 1024 * 1024;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function hashPayload(
  payload: JsonObject,
  maxBytes = DEFAULT_MAX_OPERATION_BYTES,
  subtle: SubtleCrypto | null = defaultSubtleCrypto(),
): Promise<string> {
  validatePayload(payload);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1_048_576) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  return hashCanonicalJson(
    payload,
    maxBytes,
    "OFFLINE_PAYLOAD_TOO_LARGE",
    subtle,
  );
}

export async function hashCanonicalJson(
  value: unknown,
  maxBytes: number,
  tooLargeCode: OfflineErrorCode,
  subtle: SubtleCrypto | null = defaultSubtleCrypto(),
): Promise<string> {
  if (
    !Number.isInteger(maxBytes) ||
    maxBytes < 1024 ||
    maxBytes > MAX_CANONICAL_JSON_BYTES
  ) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  let canonical: string;
  try {
    canonical = canonicalize(value);
  } catch (error) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID", false, error);
  }
  if (typeof canonical !== "string") {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  const encoded = encoder.encode(canonical);
  if (encoded.byteLength > maxBytes) {
    throw new OfflineStorageError(tooLargeCode);
  }
  if (subtle === null) {
    throw new OfflineStorageError("OFFLINE_CRYPTO_UNAVAILABLE");
  }
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest("SHA-256", encoded);
  } catch (error) {
    throw new OfflineStorageError("OFFLINE_CRYPTO_UNAVAILABLE", false, error);
  }
  return `sha256:${hex(digest)}`;
}
