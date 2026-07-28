import { LogionOfflineDatabase } from "./database";
import { OfflineStorageError } from "./errors";
import type { JsonObject, VaultRecord } from "./types";
import { validateUuid } from "./validation";

const ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requireCrypto(): Crypto {
  const runtime = globalThis as unknown as { crypto?: Partial<Crypto> };
  const secureCrypto = runtime.crypto;
  if (
    secureCrypto === undefined ||
    secureCrypto.subtle === undefined ||
    typeof secureCrypto.getRandomValues !== "function"
  ) {
    throw new OfflineStorageError("OFFLINE_CRYPTO_UNAVAILABLE");
  }
  return secureCrypto as Crypto;
}

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
  const secureCrypto = requireCrypto();
  const material = await secureCrypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return secureCrypto.subtle.deriveKey(
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
    const secureCrypto = requireCrypto();
    const salt = secureCrypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(passphrase, salt, ITERATIONS);
    const iv = secureCrypto.getRandomValues(new Uint8Array(12));
    const verifier = new Uint8Array(
      await secureCrypto.subtle.encrypt(
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
      const secureCrypto = requireCrypto();
      const key = await deriveKey(
        passphrase,
        decode(metadata.salt),
        metadata.iterations,
      );
      const clear = await secureCrypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(metadata.verifier_iv) },
        key,
        decode(metadata.verifier_ciphertext),
      );
      if (decoder.decode(clear) !== "logion-v1")
        throw new Error("invalid verifier");
      this.key = key;
    } catch (error) {
      this.key = null;
      if (
        error instanceof OfflineStorageError &&
        error.code === "OFFLINE_CRYPTO_UNAVAILABLE"
      ) {
        throw error;
      }
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
    const secureCrypto = requireCrypto();
    const iv = secureCrypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await secureCrypto.subtle.encrypt(
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
    const clear = await requireCrypto().subtle.decrypt(
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
        this.database.syncState,
        this.database.bootstrapManifests,
        this.database.bootstrapRecords,
        this.database.conflicts,
        this.database.attachmentQueue,
      ],
      async () => {
        await Promise.all([
          this.database.vaultMetadata.clear(),
          this.database.vaultRecords.clear(),
          this.database.entities.clear(),
          this.database.outbox.clear(),
          this.database.syncState.clear(),
          this.database.bootstrapManifests.clear(),
          this.database.bootstrapRecords.clear(),
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
