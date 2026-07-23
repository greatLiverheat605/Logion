import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError } from "./errors";
import type { JsonObject, VaultRecord } from "./types";
import { validateUuid } from "./validation";

const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class OfflineVault {
  private key: CryptoKey | null = null;

  constructor(private readonly database: LogionOfflineDatabase) {}

  get unlocked(): boolean {
    return this.key !== null;
  }

  async initialize(userId: string, passphrase: string): Promise<void> {
    validateUuid(userId);
    if (
      passphrase.length < 10 ||
      (await this.database.vaultMetadata.get(userId))
    ) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const verifier = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode("logion-v1"),
      ),
    );
    await this.database.vaultMetadata.add({
      user_id: userId,
      salt: encode(salt),
      verifier_iv: encode(iv),
      verifier_ciphertext: encode(verifier),
      iterations: ITERATIONS,
      created_at: new Date().toISOString(),
    });
    this.key = key;
  }

  async unlock(userId: string, passphrase: string): Promise<void> {
    validateUuid(userId);
    const metadata = await this.database.vaultMetadata.get(userId);
    if (metadata === undefined) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    try {
      const key = await deriveKey(
        passphrase,
        decode(metadata.salt),
        metadata.iterations,
      );
      const clear = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(metadata.verifier_iv) },
        key,
        decode(metadata.verifier_ciphertext),
      );
      if (decoder.decode(clear) !== "logion-v1")
        throw new Error("invalid verifier");
      this.key = key;
    } catch {
      this.key = null;
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
  }

  lock(): void {
    this.key = null;
  }

  async put(
    recordId: string,
    workspaceId: string,
    value: JsonObject,
  ): Promise<void> {
    await this.database.vaultRecords.put(
      await this.seal(recordId, workspaceId, value),
    );
  }

  async seal(
    recordId: string,
    workspaceId: string,
    value: JsonObject,
  ): Promise<VaultRecord> {
    validateUuid(recordId);
    validateUuid(workspaceId);
    const key = this.requireKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode(`${workspaceId}:${recordId}`),
        },
        key,
        encoder.encode(JSON.stringify(value)),
      ),
    );
    return {
      record_id: recordId,
      workspace_id: workspaceId,
      iv: encode(iv),
      ciphertext: encode(ciphertext),
      updated_at: new Date().toISOString(),
    };
  }

  async get(recordId: string, workspaceId: string): Promise<JsonObject | null> {
    validateUuid(recordId);
    validateUuid(workspaceId);
    const key = this.requireKey();
    const record = await this.database.vaultRecords.get(recordId);
    if (record === undefined) return null;
    if (record.workspace_id !== workspaceId) {
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    }
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(record.iv),
        additionalData: encoder.encode(`${workspaceId}:${recordId}`),
      },
      key,
      decode(record.ciphertext),
    );
    return JSON.parse(decoder.decode(clear)) as JsonObject;
  }

  async wipeLocalData(): Promise<void> {
    this.lock();
    await this.database.transaction(
      "rw",
      [
        this.database.vaultMetadata,
        this.database.vaultRecords,
        this.database.entities,
        this.database.outbox,
        this.database.conflicts,
        this.database.attachmentQueue,
      ],
      async () => {
        await Promise.all([
          this.database.vaultMetadata.clear(),
          this.database.vaultRecords.clear(),
          this.database.entities.clear(),
          this.database.outbox.clear(),
          this.database.conflicts.clear(),
          this.database.attachmentQueue.clear(),
        ]);
      },
    );
  }

  private requireKey(): CryptoKey {
    if (this.key === null)
      throw new OfflineStorageError("OFFLINE_INPUT_INVALID");
    return this.key;
  }
}
