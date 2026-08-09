import { describe, expect, it } from "vitest";

import { OfflineStorageError } from "@logion/offline";

import { offlineUnlockMessage } from "./offline-error-message";

describe("offlineUnlockMessage", () => {
  it("explains an invalid local passphrase", () => {
    expect(
      offlineUnlockMessage(new OfflineStorageError("OFFLINE_INPUT_INVALID")),
    ).toBe("本地口令不正确，或输入不符合要求。");
  });

  it("keeps browser capability errors actionable", () => {
    expect(
      offlineUnlockMessage(
        new OfflineStorageError("OFFLINE_STORAGE_UNAVAILABLE"),
      ),
    ).toContain("IndexedDB");
  });

  it("does not claim unrelated errors are passphrase failures", () => {
    expect(
      offlineUnlockMessage(
        new OfflineStorageError("OFFLINE_TRANSACTION_FAILED"),
      ),
    ).toBeNull();
  });
});
