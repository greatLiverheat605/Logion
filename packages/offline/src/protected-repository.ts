import { LogionOfflineDatabase } from "./database";
import { hashPayload } from "./hashing";
import { OfflineRepository, type MutationCommitResult } from "./repository";
import type { JsonObject, ProtectedMutationInput } from "./types";
import { OfflineVault } from "./vault";

function reference(recordId: string): JsonObject {
  return { encrypted_payload_ref: recordId };
}

export class ProtectedOfflineRepository {
  private readonly repository: OfflineRepository;

  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly vault: OfflineVault,
  ) {
    this.repository = new OfflineRepository(database);
  }

  async commitMutation(
    input: ProtectedMutationInput,
  ): Promise<MutationCommitResult> {
    const payloadHash = await hashPayload(input.payload);
    const protectedInput = {
      ...input,
      payload: reference(input.operation_id),
    };
    const options = {
      payloadHash,
      payloadVaultId: input.operation_id,
    };
    if ((await this.database.outbox.get(input.operation_id)) !== undefined) {
      return this.repository.commitMutation(protectedInput, options);
    }
    await this.vault.put(input.operation_id, input.workspace_id, input.payload);
    try {
      return await this.repository.commitMutation(protectedInput, options);
    } catch (error) {
      await this.database.vaultRecords.delete(input.operation_id);
      throw error;
    }
  }
}
