import { canonicalize } from "json-canonicalize";

import { OfflineStorageError } from "./errors";
import { DEFAULT_MAX_OPERATION_BYTES, validatePayload } from "./validation";
import type { JsonObject } from "./types";

const encoder = new TextEncoder();

function defaultSubtleCrypto(): SubtleCrypto | null {
  const runtime = globalThis as unknown as { crypto?: Crypto };
  return runtime.crypto?.subtle ?? null;
}

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
  const canonical = canonicalize(payload);
  const encoded = encoder.encode(canonical);
  if (encoded.byteLength > maxBytes) {
    throw new OfflineStorageError("OFFLINE_PAYLOAD_TOO_LARGE");
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
