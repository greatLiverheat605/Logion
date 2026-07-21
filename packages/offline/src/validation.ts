import { OfflineStorageError } from "./errors";
import type { JsonObject, JsonValue, LocalMutationInput } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_PAYLOAD_DEPTH = 20;
const MAX_PAYLOAD_NODES = 10_000;
const MAX_CONTAINER_ITEMS = 1_000;
const OPERATION_TYPES = new Set(["create", "delete", "restore", "update"]);
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
export const DEFAULT_MAX_OPERATION_BYTES = 256 * 1024;

function invalid(): never {
  throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
}

export function validateUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
}

export function validateSyncErrorCode(value: string | null): void {
  if (value !== null && !/^SYNC_[A-Z0-9_]{2,80}$/.test(value)) invalid();
}

function assertDateTime(value: string | null): void {
  if (value === null) return;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !DATE_TIME_PATTERN.test(value)) invalid();
}

function assertJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  state: { nodes: number },
): asserts value is JsonValue {
  if (depth > MAX_PAYLOAD_DEPTH) invalid();
  state.nodes += 1;
  if (state.nodes > MAX_PAYLOAD_NODES) invalid();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return;
  }
  if (typeof value !== "object") invalid();
  if (ancestors.has(value)) invalid();
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTAINER_ITEMS) invalid();
    for (const item of value) {
      assertJsonValue(item, depth + 1, ancestors, state);
    }
  } else {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const entries = Object.entries(value);
    if (entries.length > MAX_CONTAINER_ITEMS) invalid();
    for (const [key, item] of entries) {
      if (
        key.length === 0 ||
        key.length > 128 ||
        FORBIDDEN_OBJECT_KEYS.has(key)
      ) {
        invalid();
      }
      assertJsonValue(item, depth + 1, ancestors, state);
    }
  }
  ancestors.delete(value);
}

export function validatePayload(value: unknown): asserts value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  assertJsonValue(value, 0, new Set(), { nodes: 0 });
  if (Object.keys(value).length > 200) invalid();
}

export function validateMutation(input: LocalMutationInput): void {
  if (
    (input as { protocol_version: unknown }).protocol_version !== "sync-v1" ||
    !OPERATION_TYPES.has(input.operation_type)
  ) {
    invalid();
  }
  for (const value of [
    input.operation_id,
    input.workspace_id,
    input.device_id,
    input.entity_id,
    input.created_by,
    input.updated_by,
    ...(input.dependencies ?? []),
  ]) {
    validateUuid(value);
  }
  if (!ENTITY_TYPE_PATTERN.test(input.entity_type)) invalid();
  if (!Number.isInteger(input.base_version) || input.base_version < 0)
    invalid();
  if (!Number.isInteger(input.local_revision) || input.local_revision < 1) {
    invalid();
  }
  if (input.dependencies?.includes(input.operation_id)) invalid();
  if (
    new Set(input.dependencies ?? []).size !== (input.dependencies ?? []).length
  ) {
    invalid();
  }
  if ((input.dependencies?.length ?? 0) > 100) invalid();
  for (const date of [
    input.client_occurred_at,
    input.created_at,
    input.updated_at,
    input.deleted_at,
  ]) {
    assertDateTime(date);
  }
  if (input.operation_type === "delete" && input.deleted_at === null) invalid();
  if (input.operation_type !== "delete" && input.deleted_at !== null) invalid();
  if (Date.parse(input.updated_at) < Date.parse(input.created_at)) invalid();
  validatePayload(input.payload);
  if (
    input.operation_type === "delete" &&
    Object.keys(input.payload).length > 0
  ) {
    invalid();
  }
}

export function databaseNameForUser(userId: string): string {
  validateUuid(userId);
  return `logion-offline-v1-${userId.toLowerCase()}`;
}
