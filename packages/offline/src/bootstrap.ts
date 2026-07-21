import {
  validateSyncV1Message,
  type BootstrapResponse,
} from "@logion/contracts";
import Dexie from "dexie";

import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError, normalizeStorageError } from "./errors";
import {
  hashCanonicalJson,
  hashPayload,
  MAX_CANONICAL_JSON_BYTES,
} from "./hashing";
import {
  OFFLINE_SCHEMA_VERSION,
  type BootstrapContext,
  type BootstrapManifest,
  type BootstrapProgress,
  type BootstrapRepositoryOptions,
  type BootstrapStagedRecord,
  type JsonObject,
  type LocalEntity,
} from "./types";
import { validatePayload, validateUuid } from "./validation";
import { OfflineVault } from "./vault";

export const DEFAULT_MAX_SNAPSHOT_CHUNK_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_BOOTSTRAP_OPERATION_BYTES = 256 * 1024;

function entityKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`;
}

function sameManifest(
  manifest: BootstrapManifest,
  message: BootstrapResponse,
  context: BootstrapContext,
): boolean {
  return (
    manifest.workspace_id === context.workspace_id &&
    manifest.device_id === context.device_id &&
    manifest.sync_epoch === message.sync_epoch &&
    manifest.chunk_count === message.chunk_count &&
    manifest.cursor === message.cursor &&
    manifest.snapshot_checksum === message.snapshot_checksum &&
    manifest.created_at === message.created_at
  );
}

function progress(manifest: BootstrapManifest): BootstrapProgress {
  return {
    workspace_id: manifest.workspace_id,
    snapshot_id: manifest.snapshot_id,
    received_chunks: manifest.received_chunks.length,
    chunk_count: manifest.chunk_count,
    received_records: manifest.received_records,
    complete: manifest.status === "complete",
  };
}

function toLocalEntity(record: BootstrapStagedRecord): LocalEntity {
  return {
    workspace_id: record.workspace_id,
    entity_type: record.entity_type,
    entity_id: record.entity_id,
    server_version: record.version,
    local_revision: 0,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted_at: record.deleted_at,
    created_by: record.created_by,
    updated_by: record.updated_by,
    payload: record.payload,
    payload_hash: record.payload_hash,
    sync_status: "clean",
  };
}

export class BootstrapRepository {
  private readonly maxSnapshotChunkBytes: number;
  private readonly maxOperationBytes: number;
  private readonly subtleCrypto: SubtleCrypto | null | undefined;

  constructor(
    private readonly database: LogionOfflineDatabase,
    options: BootstrapRepositoryOptions = {},
    private readonly vault?: OfflineVault,
  ) {
    this.maxSnapshotChunkBytes =
      options.maxSnapshotChunkBytes ?? DEFAULT_MAX_SNAPSHOT_CHUNK_BYTES;
    this.maxOperationBytes =
      options.maxOperationBytes ?? DEFAULT_MAX_BOOTSTRAP_OPERATION_BYTES;
    this.subtleCrypto = options.subtleCrypto;
    if (
      !Number.isInteger(this.maxSnapshotChunkBytes) ||
      this.maxSnapshotChunkBytes < 1024 ||
      this.maxSnapshotChunkBytes > 16 * 1024 * 1024 ||
      !Number.isInteger(this.maxOperationBytes) ||
      this.maxOperationBytes < 1024 ||
      this.maxOperationBytes > 1024 * 1024
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
  }

  async stageChunk(
    value: unknown,
    context: BootstrapContext,
  ): Promise<BootstrapProgress> {
    try {
      validateUuid(context.workspace_id);
      validateUuid(context.device_id);
      const validation = validateSyncV1Message(value);
      if (
        !validation.ok ||
        validation.value.message_type !== "bootstrap_response"
      ) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_INVALID");
      }
      const message = validation.value;
      if (
        message.workspace_id !== context.workspace_id ||
        message.device_id !== context.device_id ||
        message.chunk_index >= message.chunk_count
      ) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
      }
      validateUuid(message.sync_epoch);
      validateUuid(message.snapshot_id);
      const chunkChecksum = await hashCanonicalJson(
        message.records,
        this.maxSnapshotChunkBytes,
        "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE",
        this.subtleCrypto,
      );
      if (chunkChecksum !== message.chunk_checksum) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CHUNK_HASH_MISMATCH");
      }

      const seen = new Set<string>();
      for (const record of message.records) {
        validateUuid(record.entity_id);
        validateUuid(record.created_by);
        validateUuid(record.updated_by);
        validatePayload(record.payload);
        const key = entityKey(record.entity_type, record.entity_id);
        if (seen.has(key)) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_DUPLICATE_ENTITY");
        }
        seen.add(key);
      }
      const payloadHashes = await Promise.all(
        message.records.map((record) =>
          hashPayload(
            record.payload as JsonObject,
            this.maxOperationBytes,
            this.subtleCrypto,
          ),
        ),
      );
      if (
        message.records.some(
          (record, index) => record.payload_hash !== payloadHashes[index],
        )
      ) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_RECORD_HASH_MISMATCH");
      }
      let protectedMessage = message;
      if (
        message.records.some((record) => record.entity_type === "learning_goal")
      ) {
        const vault = this.vault;
        if (vault === undefined) {
          throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
        }
        const records = await Promise.all(
          message.records.map(async (record) => {
            if (record.entity_type !== "learning_goal") return record;
            await vault.put(
              record.entity_id,
              context.workspace_id,
              record.payload as JsonObject,
            );
            return {
              ...record,
              payload: { encrypted_payload_ref: record.entity_id },
            };
          }),
        );
        protectedMessage = { ...message, records };
      }
      return await this.persistVerifiedChunk(protectedMessage, context);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async getProgress(
    context: BootstrapContext,
    snapshotId: string,
  ): Promise<BootstrapProgress | null> {
    try {
      validateUuid(context.workspace_id);
      validateUuid(context.device_id);
      validateUuid(snapshotId);
      const manifest = await this.database.bootstrapManifests.get([
        context.workspace_id,
        snapshotId,
      ]);
      if (manifest === undefined) return null;
      if (manifest.device_id !== context.device_id) {
        throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
      }
      return progress(manifest);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async discardStaging(
    context: BootstrapContext,
    snapshotId: string,
  ): Promise<boolean> {
    try {
      validateUuid(context.workspace_id);
      validateUuid(context.device_id);
      validateUuid(snapshotId);
      return await this.database.transaction(
        "rw",
        this.database.bootstrapManifests,
        this.database.bootstrapRecords,
        async () => {
          const manifest = await this.database.bootstrapManifests.get([
            context.workspace_id,
            snapshotId,
          ]);
          if (manifest === undefined) return false;
          if (
            manifest.device_id !== context.device_id ||
            manifest.status !== "staging"
          ) {
            throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
          }
          await this.database.bootstrapRecords
            .where("[workspace_id+snapshot_id]")
            .equals([context.workspace_id, snapshotId])
            .delete();
          await this.database.bootstrapManifests.delete([
            context.workspace_id,
            snapshotId,
          ]);
          return true;
        },
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  private async persistVerifiedChunk(
    message: BootstrapResponse,
    context: BootstrapContext,
  ): Promise<BootstrapProgress> {
    return this.database.transaction(
      "rw",
      this.database.bootstrapManifests,
      this.database.bootstrapRecords,
      this.database.entities,
      this.database.outbox,
      this.database.syncState,
      async () => {
        const manifestKey: [string, string] = [
          context.workspace_id,
          message.snapshot_id,
        ];
        const workspaceManifests = await this.database.bootstrapManifests
          .where("workspace_id")
          .equals(context.workspace_id)
          .toArray();
        if (
          workspaceManifests.some(
            (manifest) => manifest.device_id !== context.device_id,
          )
        ) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }
        const currentState = await this.database.syncState.get(
          context.workspace_id,
        );
        if (
          currentState !== undefined &&
          currentState.device_id !== context.device_id
        ) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }
        const otherStaging = workspaceManifests.find(
          (item) =>
            item.snapshot_id !== message.snapshot_id &&
            item.status === "staging",
        );
        if (otherStaging !== undefined) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }
        const previous =
          await this.database.bootstrapManifests.get(manifestKey);
        if (
          previous !== undefined &&
          !sameManifest(previous, message, context)
        ) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }
        const replay = previous?.received_chunks.find(
          (item) => item.chunk_index === message.chunk_index,
        );
        if (replay !== undefined && previous !== undefined) {
          if (replay.chunk_checksum !== message.chunk_checksum) {
            throw new OfflineStorageError(
              "OFFLINE_BOOTSTRAP_CHUNK_HASH_MISMATCH",
            );
          }
          return progress(previous);
        }
        if (previous?.status === "complete") {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }

        const incomingEntityKeys = message.records.map<
          [string, string, string, string]
        >((record) => [
          context.workspace_id,
          message.snapshot_id,
          record.entity_type,
          record.entity_id,
        ]);
        const existingDuplicate =
          incomingEntityKeys.length === 0
            ? undefined
            : await this.database.bootstrapRecords
                .where("[workspace_id+snapshot_id+entity_type+entity_id]")
                .anyOf(incomingEntityKeys)
                .first();
        if (existingDuplicate !== undefined) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_DUPLICATE_ENTITY");
        }

        const staged = message.records.map<BootstrapStagedRecord>(
          (record, recordIndex) => ({
            ...record,
            workspace_id: context.workspace_id,
            snapshot_id: message.snapshot_id,
            chunk_index: message.chunk_index,
            record_index: recordIndex,
            payload: record.payload as JsonObject,
          }),
        );
        await this.database.bootstrapRecords.bulkAdd(staged);
        const receivedChunks = [
          ...(previous?.received_chunks ?? []),
          {
            chunk_index: message.chunk_index,
            chunk_checksum: message.chunk_checksum,
          },
        ].sort((left, right) => left.chunk_index - right.chunk_index);
        const manifest: BootstrapManifest = {
          workspace_id: context.workspace_id,
          snapshot_id: message.snapshot_id,
          device_id: context.device_id,
          sync_epoch: message.sync_epoch,
          snapshot_schema_version: message.snapshot_schema_version,
          chunk_count: message.chunk_count,
          cursor: message.cursor,
          snapshot_checksum: message.snapshot_checksum,
          created_at: message.created_at,
          received_chunks: receivedChunks,
          received_records:
            (previous?.received_records ?? 0) + message.records.length,
          status: "staging",
        };
        await this.database.bootstrapManifests.put(manifest);
        if (receivedChunks.length !== message.chunk_count) {
          return progress(manifest);
        }
        for (let index = 0; index < receivedChunks.length; index += 1) {
          if (receivedChunks[index]?.chunk_index !== index) {
            throw new OfflineStorageError("OFFLINE_BOOTSTRAP_INVALID");
          }
        }
        const snapshotChecksum = await Dexie.waitFor(
          hashCanonicalJson(
            { chunks: receivedChunks },
            MAX_CANONICAL_JSON_BYTES,
            "OFFLINE_BOOTSTRAP_CHUNK_TOO_LARGE",
            this.subtleCrypto,
          ),
        );
        if (snapshotChecksum !== message.snapshot_checksum) {
          throw new OfflineStorageError(
            "OFFLINE_BOOTSTRAP_SNAPSHOT_HASH_MISMATCH",
          );
        }

        const allStaged = (
          await this.database.bootstrapRecords
            .where("[workspace_id+snapshot_id]")
            .equals([context.workspace_id, message.snapshot_id])
            .toArray()
        ).sort(
          (left, right) =>
            left.chunk_index - right.chunk_index ||
            left.record_index - right.record_index,
        );
        const epochChanged =
          currentState?.sync_epoch !== null &&
          currentState?.sync_epoch !== undefined &&
          currentState.sync_epoch !== message.sync_epoch;
        const workspaceOperations = await this.database.outbox
          .where("workspace_id")
          .equals(context.workspace_id)
          .toArray();
        if (
          workspaceOperations.some(
            (operation) => operation.device_id !== context.device_id,
          )
        ) {
          throw new OfflineStorageError("OFFLINE_BOOTSTRAP_CONTEXT_MISMATCH");
        }
        const currentEntities = await this.database.entities
          .where("workspace_id")
          .equals(context.workspace_id)
          .toArray();
        const preserved = epochChanged
          ? []
          : currentEntities.filter((entity) => entity.sync_status !== "clean");
        const preservedKeys = new Set(
          preserved.map((entity) =>
            entityKey(entity.entity_type, entity.entity_id),
          ),
        );
        const activated = allStaged
          .filter(
            (record) =>
              !preservedKeys.has(
                entityKey(record.entity_type, record.entity_id),
              ),
          )
          .map(toLocalEntity);
        const activatedAt = new Date().toISOString();

        if (epochChanged) {
          await this.database.outbox.bulkPut(
            workspaceOperations.map((operation) => ({
              ...operation,
              outbox_state: "isolated" as const,
              last_error_code: "SYNC_EPOCH_MISMATCH",
            })),
          );
        }
        await this.database.entities
          .where("workspace_id")
          .equals(context.workspace_id)
          .delete();
        await this.database.entities.bulkPut([...activated, ...preserved]);
        await this.database.syncState.put({
          workspace_id: context.workspace_id,
          device_id: context.device_id,
          schema_version: OFFLINE_SCHEMA_VERSION,
          sync_epoch: message.sync_epoch,
          cursor: message.cursor,
          bootstrap_state: "ready",
          last_sync_at: activatedAt,
          outbox_isolated_at: epochChanged
            ? activatedAt
            : (currentState?.outbox_isolated_at ?? null),
          isolation_reason_code: epochChanged
            ? "SYNC_EPOCH_MISMATCH"
            : (currentState?.isolation_reason_code ?? null),
        });
        manifest.status = "complete";
        await this.database.bootstrapManifests.put(manifest);
        await this.database.bootstrapRecords
          .where("[workspace_id+snapshot_id]")
          .equals([context.workspace_id, message.snapshot_id])
          .delete();
        for (const old of workspaceManifests) {
          if (
            old.snapshot_id !== message.snapshot_id &&
            old.status === "complete"
          ) {
            await this.database.bootstrapManifests.delete([
              old.workspace_id,
              old.snapshot_id,
            ]);
          }
        }
        return progress(manifest);
      },
    );
  }
}
