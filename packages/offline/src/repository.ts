import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import { hashPayload } from "./hashing";
import type {
  LocalEntity,
  LocalMutationInput,
  OutboxEntry,
  OutboxState,
} from "./types";
import {
  validateMutation,
  validateSyncErrorCode,
  validateUuid,
} from "./validation";

const OUTBOX_STATES = new Set<OutboxState>([
  "blocked",
  "conflict",
  "in_flight",
  "isolated",
  "pending",
]);

export type MutationCommitResult =
  | { kind: "committed"; entity: LocalEntity; operation: OutboxEntry }
  | { kind: "duplicate"; entity: LocalEntity; operation: OutboxEntry };

function sameOperation(left: OutboxEntry, right: OutboxEntry): boolean {
  return (
    left.payload_hash === right.payload_hash &&
    left.workspace_id === right.workspace_id &&
    left.device_id === right.device_id &&
    left.entity_type === right.entity_type &&
    left.entity_id === right.entity_id &&
    left.operation_type === right.operation_type &&
    left.base_version === right.base_version &&
    left.client_occurred_at === right.client_occurred_at &&
    JSON.stringify(left.conflict_resolution) ===
      JSON.stringify(right.conflict_resolution)
  );
}

function validateTransition(
  input: LocalMutationInput,
  existing: LocalEntity | undefined,
): void {
  if (input.operation_type === "create") {
    if (
      existing !== undefined ||
      input.base_version !== 0 ||
      input.local_revision !== 1
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    return;
  }
  if (
    existing === undefined ||
    input.base_version !== existing.server_version ||
    input.local_revision !== existing.local_revision + 1 ||
    input.created_at !== existing.created_at ||
    input.created_by !== existing.created_by
  ) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  if (input.operation_type === "restore" && existing.deleted_at === null) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
  if (input.operation_type !== "restore" && existing.deleted_at !== null) {
    throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
  }
}

export class OfflineRepository {
  constructor(private readonly database: LogionOfflineDatabase) {}

  async commitMutation(
    input: LocalMutationInput,
  ): Promise<MutationCommitResult> {
    validateMutation(input);
    const hash = await hashPayload(input.payload);
    const operation: OutboxEntry = {
      operation_id: input.operation_id,
      protocol_version: "sync-v1",
      workspace_id: input.workspace_id,
      device_id: input.device_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      operation_type: input.operation_type,
      base_version: input.base_version,
      client_occurred_at: input.client_occurred_at,
      payload: input.payload,
      payload_hash: hash,
      dependencies: input.dependencies ?? [],
      conflict_resolution: null,
      outbox_state: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      last_error_code: null,
      queued_at: input.client_occurred_at,
    };
    const entity: LocalEntity = {
      workspace_id: input.workspace_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      server_version: input.base_version,
      local_revision: input.local_revision,
      created_at: input.created_at,
      updated_at: input.updated_at,
      deleted_at: input.deleted_at,
      created_by: input.created_by,
      updated_by: input.updated_by,
      payload: input.payload,
      payload_hash: hash,
      sync_status: "pending",
    };

    try {
      return await this.database.transaction(
        "rw",
        this.database.entities,
        this.database.outbox,
        async () => {
          const existing = await this.database.outbox.get(input.operation_id);
          if (existing !== undefined) {
            if (!sameOperation(existing, operation)) {
              throw new OfflineStorageError("OFFLINE_OPERATION_HASH_MISMATCH");
            }
            const existingEntity = await this.database.entities.get([
              input.workspace_id,
              input.entity_type,
              input.entity_id,
            ]);
            if (existingEntity === undefined) {
              throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
            }
            return {
              kind: "duplicate",
              entity: existingEntity,
              operation: existing,
            };
          }
          const relatedOperations = await this.database.outbox
            .where("[workspace_id+entity_type+entity_id]")
            .equals([input.workspace_id, input.entity_type, input.entity_id])
            .toArray();
          const predecessor = relatedOperations
            .filter(
              (candidate) => candidate.operation_id !== input.operation_id,
            )
            .sort(
              (left, right) =>
                left.queued_at.localeCompare(right.queued_at) ||
                left.operation_id.localeCompare(right.operation_id),
            )
            .at(-1);
          if (
            predecessor !== undefined &&
            !operation.dependencies.includes(predecessor.operation_id)
          ) {
            if (operation.dependencies.length >= 100) {
              throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
            }
            operation.dependencies.push(predecessor.operation_id);
          }
          const currentEntity = await this.database.entities.get([
            input.workspace_id,
            input.entity_type,
            input.entity_id,
          ]);
          validateTransition(input, currentEntity);
          await this.database.entities.put(entity);
          await this.database.outbox.add(operation);
          return { kind: "committed", entity, operation };
        },
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listReadyOperations(
    workspaceId: string,
    deviceId: string,
  ): Promise<OutboxEntry[]> {
    validateUuid(workspaceId);
    validateUuid(deviceId);
    const all = await this.database.outbox
      .where("[workspace_id+device_id]")
      .equals([workspaceId, deviceId])
      .toArray();
    const byId = new Map(
      all.map((operation) => [operation.operation_id, operation]),
    );
    const pending = all.filter(
      (operation) =>
        operation.outbox_state === "pending" &&
        !dependsOnUnreadyOperation(operation, byId, new Set()),
    );
    pending.sort(
      (left, right) =>
        left.queued_at.localeCompare(right.queued_at) ||
        left.operation_id.localeCompare(right.operation_id),
    );
    return topologicalOrder(pending);
  }

  async setOperationState(
    workspaceId: string,
    deviceId: string,
    operationId: string,
    state: OutboxState,
    errorCode: string | null = null,
  ): Promise<void> {
    validateUuid(workspaceId);
    validateUuid(deviceId);
    validateUuid(operationId);
    validateSyncErrorCode(errorCode);
    if (!OUTBOX_STATES.has(state)) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    try {
      await this.database.transaction("rw", this.database.outbox, async () => {
        const existing = await this.database.outbox.get(operationId);
        if (
          existing === undefined ||
          existing.workspace_id !== workspaceId ||
          existing.device_id !== deviceId
        ) {
          throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
        }
        await this.database.outbox.update(operationId, {
          outbox_state: state,
          last_error_code: errorCode,
        });
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}

function dependsOnUnreadyOperation(
  operation: OutboxEntry,
  byId: Map<string, OutboxEntry>,
  visiting: Set<string>,
): boolean {
  if (visiting.has(operation.operation_id)) {
    throw new OfflineStorageError("OFFLINE_DEPENDENCY_CYCLE");
  }
  visiting.add(operation.operation_id);
  for (const dependencyId of operation.dependencies) {
    const dependency = byId.get(dependencyId);
    if (dependency === undefined) continue;
    if (
      dependency.outbox_state !== "pending" ||
      dependsOnUnreadyOperation(dependency, byId, visiting)
    ) {
      visiting.delete(operation.operation_id);
      return true;
    }
  }
  visiting.delete(operation.operation_id);
  return false;
}

function topologicalOrder(operations: OutboxEntry[]): OutboxEntry[] {
  const byId = new Map(
    operations.map((operation) => [operation.operation_id, operation]),
  );
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: OutboxEntry[] = [];

  const visit = (operation: OutboxEntry): void => {
    if (visited.has(operation.operation_id)) return;
    if (visiting.has(operation.operation_id)) {
      throw new OfflineStorageError("OFFLINE_DEPENDENCY_CYCLE");
    }
    visiting.add(operation.operation_id);
    for (const dependency of operation.dependencies) {
      const pendingDependency = byId.get(dependency);
      if (pendingDependency !== undefined) visit(pendingDependency);
    }
    visiting.delete(operation.operation_id);
    visited.add(operation.operation_id);
    result.push(operation);
  };

  for (const operation of operations) visit(operation);
  return result;
}
