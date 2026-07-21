import {
  validateSyncV1Message,
  type PullResponse,
  type PullRequest,
  type PushRequest,
  type SyncOperationV1,
} from "@logion/contracts";

import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import { OfflineRepository } from "./repository";
import { isProtectedEntityType } from "./protected-entities";
import type {
  JsonObject,
  LocalEntity,
  OutboxEntry,
  WorkspaceSyncState,
} from "./types";
import { validateUuid } from "./validation";
import { OfflineVault } from "./vault";

export interface SyncTransport {
  push(request: PushRequest): Promise<unknown>;
  pull(request: PullRequest): Promise<unknown>;
}

export interface SyncCycleResult {
  pushed: number;
  pulled: number;
  has_more: boolean;
  control:
    | "cursor_expired"
    | "rebootstrap_required"
    | "upgrade_required"
    | null;
}

type ReadySyncState = WorkspaceSyncState & {
  bootstrap_state: "ready";
  sync_epoch: string;
};

export class SyncClient {
  private readonly repository: OfflineRepository;

  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly transport: SyncTransport,
    private readonly vault?: OfflineVault,
  ) {
    this.repository = new OfflineRepository(database);
  }

  async synchronize(
    workspaceId: string,
    deviceId: string,
  ): Promise<SyncCycleResult> {
    validateUuid(workspaceId);
    validateUuid(deviceId);
    const state = await this.requireReadyState(workspaceId, deviceId);
    try {
      const pushResult = await this.pushReady(state);
      if (pushResult.control !== null) {
        return {
          pushed: pushResult.pushed,
          pulled: 0,
          has_more: false,
          control: pushResult.control,
        };
      }
      const pulled = await this.pullPages(state);
      return { pushed: pushResult.pushed, ...pulled };
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  private async pushReady(state: ReadySyncState): Promise<{
    pushed: number;
    control: SyncCycleResult["control"];
  }> {
    const ready = (
      await this.repository.listReadyOperations(
        state.workspace_id,
        state.device_id,
      )
    ).slice(0, 100);
    if (ready.length === 0) return { pushed: 0, control: null };
    const request: PushRequest = {
      message_type: "push_request",
      protocol_version: "sync-v1",
      workspace_id: state.workspace_id,
      device_id: state.device_id,
      sync_epoch: state.sync_epoch,
      operations: (await Promise.all(
        ready.map((operation) => this.transportOperation(operation)),
      )) as PushRequest["operations"],
    };
    const raw = await this.transport.push(request);
    const validation = validateSyncV1Message(raw);
    if (!validation.ok) throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    const message = validation.value;
    if (message.message_type === "sync_control") {
      await this.applyControl(state, message.action);
      return {
        pushed: 0,
        control: message.action,
      };
    }
    if (
      message.message_type !== "push_response" ||
      message.workspace_id !== state.workspace_id ||
      message.device_id !== state.device_id ||
      message.sync_epoch !== state.sync_epoch ||
      message.results.length !== ready.length
    ) {
      throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
    }
    const protectedConflicts = new Map<string, JsonObject>();
    for (const result of message.results) {
      if (
        result.status === "conflict" &&
        isProtectedEntityType(result.conflict.entity_type)
      ) {
        if (this.vault === undefined) {
          throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
        }
        await this.vault.put(
          result.conflict.conflict_id,
          state.workspace_id,
          result.conflict.remote_payload as JsonObject,
        );
        protectedConflicts.set(result.conflict.conflict_id, {
          encrypted_payload_ref: result.conflict.conflict_id,
        });
      }
    }
    await this.database.transaction(
      "rw",
      this.database.outbox,
      this.database.entities,
      this.database.conflicts,
      async () => {
        for (let index = 0; index < ready.length; index += 1) {
          const operation = ready[index];
          const result = message.results[index];
          if (operation === undefined || result === undefined) {
            throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
          }
          if (result.operation_id !== operation.operation_id) {
            throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
          }
          if (result.status === "applied" || result.status === "duplicate") {
            await this.database.outbox.delete(operation.operation_id);
            const key: [string, string, string] = [
              state.workspace_id,
              operation.entity_type,
              operation.entity_id,
            ];
            const entity = await this.database.entities.get(key);
            if (entity !== undefined) {
              await this.database.entities.update(key, {
                server_version: result.server_version,
                sync_status: "clean",
              });
            }
          } else {
            if (result.status === "conflict") {
              const local = await this.database.entities.get([
                state.workspace_id,
                operation.entity_type,
                operation.entity_id,
              ]);
              if (local === undefined) {
                throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
              }
              await this.database.conflicts.put({
                ...result.conflict,
                workspace_id: state.workspace_id,
                local_payload: local.payload,
                remote_payload:
                  protectedConflicts.get(result.conflict.conflict_id) ??
                  (result.conflict.remote_payload as JsonObject),
                resolved_at: null,
              });
              await this.database.entities.update(
                [
                  state.workspace_id,
                  operation.entity_type,
                  operation.entity_id,
                ],
                { sync_status: "conflict" },
              );
            }
            await this.database.outbox.update(operation.operation_id, {
              outbox_state:
                result.status === "conflict" ? "conflict" : "blocked",
              last_error_code:
                result.status === "conflict"
                  ? "SYNC_CONFLICT"
                  : "error_code" in result
                    ? result.error_code
                    : "SYNC_OPERATION_REJECTED",
            });
          }
        }
      },
    );
    return { pushed: ready.length, control: null };
  }

  private async pullPages(state: ReadySyncState): Promise<{
    pulled: number;
    has_more: boolean;
    control: SyncCycleResult["control"];
  }> {
    let pulled = 0;
    for (let page = 0; page < 1000; page += 1) {
      const current = await this.requireReadyState(
        state.workspace_id,
        state.device_id,
      );
      const raw = await this.transport.pull({
        message_type: "pull_request",
        protocol_version: "sync-v1",
        workspace_id: current.workspace_id,
        device_id: current.device_id,
        sync_epoch: current.sync_epoch,
        cursor: current.cursor,
        limit: 500,
      });
      const validation = validateSyncV1Message(raw);
      if (!validation.ok)
        throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
      const message = validation.value;
      if (message.message_type === "sync_control") {
        await this.applyControl(current, message.action);
        return {
          pulled,
          has_more: false,
          control: message.action as SyncCycleResult["control"],
        };
      }
      if (
        message.message_type !== "pull_response" ||
        message.workspace_id !== current.workspace_id ||
        message.device_id !== current.device_id ||
        message.sync_epoch !== current.sync_epoch ||
        message.from_cursor !== current.cursor
      ) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
      }
      await this.applyPull(current, message);
      pulled += message.changes.length;
      if (!message.has_more) return { pulled, has_more: false, control: null };
    }
    return { pulled, has_more: true, control: null };
  }

  private async applyPull(
    state: WorkspaceSyncState,
    message: PullResponse,
  ): Promise<void> {
    const protectedPayloads = new Map<string, JsonObject>();
    for (const change of message.changes) {
      if (isProtectedEntityType(change.entity_type)) {
        if (this.vault === undefined) {
          throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
        }
        await this.vault.put(
          change.entity_id,
          state.workspace_id,
          change.payload as JsonObject,
        );
        protectedPayloads.set(change.entity_id, {
          encrypted_payload_ref: change.entity_id,
        });
      }
    }
    await this.database.transaction(
      "rw",
      this.database.entities,
      this.database.syncState,
      async () => {
        let expected = message.from_cursor;
        for (const change of message.changes) {
          if (
            change.sequence <= expected ||
            change.sequence > message.next_cursor
          ) {
            throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
          }
          expected = change.sequence;
          const key: [string, string, string] = [
            state.workspace_id,
            change.entity_type,
            change.entity_id,
          ];
          const existing = await this.database.entities.get(key);
          if (existing?.sync_status === "pending") {
            await this.database.entities.update(key, {
              sync_status: "conflict",
            });
            continue;
          }
          const actor = existing?.updated_by ?? state.device_id;
          const entity: LocalEntity = {
            workspace_id: state.workspace_id,
            entity_type: change.entity_type,
            entity_id: change.entity_id,
            server_version: change.server_version,
            local_revision: existing?.local_revision ?? 0,
            created_at: existing?.created_at ?? change.occurred_at,
            updated_at: change.occurred_at,
            deleted_at: change.deleted_at,
            created_by: existing?.created_by ?? actor,
            updated_by: actor,
            payload:
              protectedPayloads.get(change.entity_id) ??
              (change.payload as JsonObject),
            payload_hash: change.payload_hash,
            sync_status: "clean",
          };
          await this.database.entities.put(entity);
        }
        if (
          message.next_cursor < expected ||
          message.next_cursor < message.from_cursor
        ) {
          throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
        }
        await this.database.syncState.update(state.workspace_id, {
          cursor: message.next_cursor,
          last_sync_at: new Date().toISOString(),
        });
      },
    );
  }

  private async applyControl(
    state: WorkspaceSyncState,
    action: string,
  ): Promise<void> {
    if (action === "upgrade_required") {
      await this.database.syncState.update(state.workspace_id, {
        bootstrap_state: "upgrade_required",
      });
      return;
    }
    if (action !== "rebootstrap_required" && action !== "cursor_expired")
      return;
    await this.database.syncState.update(state.workspace_id, {
      bootstrap_state: "rebootstrap_required",
    });
  }

  private async requireReadyState(
    workspaceId: string,
    deviceId: string,
  ): Promise<ReadySyncState> {
    const state = await this.database.syncState.get(workspaceId);
    if (
      state === undefined ||
      state.device_id !== deviceId ||
      state.bootstrap_state !== "ready" ||
      state.sync_epoch === null
    ) {
      throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
    }
    return state as ReadySyncState;
  }

  private async transportOperation(
    operation: OutboxEntry,
  ): Promise<SyncOperationV1> {
    const base = stripLocalOperation(operation);
    if (operation.payload_vault_id === undefined) return base;
    if (this.vault === undefined) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const payload = await this.vault.get(
      operation.payload_vault_id,
      operation.workspace_id,
    );
    if (payload === null) {
      throw new OfflineStorageError("OFFLINE_TRANSACTION_FAILED");
    }
    return { ...base, payload };
  }
}

function stripLocalOperation(operation: SyncOperationV1): SyncOperationV1 {
  return {
    operation_id: operation.operation_id,
    protocol_version: operation.protocol_version,
    workspace_id: operation.workspace_id,
    device_id: operation.device_id,
    entity_type: operation.entity_type,
    entity_id: operation.entity_id,
    operation_type: operation.operation_type,
    base_version: operation.base_version,
    client_occurred_at: operation.client_occurred_at,
    payload: operation.payload,
    payload_hash: operation.payload_hash,
    conflict_resolution: operation.conflict_resolution,
    dependencies: operation.dependencies,
  };
}
