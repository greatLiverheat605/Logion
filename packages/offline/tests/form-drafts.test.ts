import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearFormDrafts,
  FORM_DRAFT_TTL_MS,
  FormDraftStore,
  formDraftId,
  isFormDraftId,
  noteDocumentStateId,
  openOfflineDatabase,
  OfflineVault,
  type FormDraftScope,
  type LogionOfflineDatabase,
} from "../src";

const ids = {
  user: "01900000-0000-7000-8000-000000000001",
  workspace: "01900000-0000-7000-8000-000000000002",
  otherWorkspace: "01900000-0000-7000-8000-000000000003",
  space: "01900000-0000-7000-8000-000000000004",
  review: "01900000-0000-7000-8000-000000000005",
  note: "01900000-0000-7000-8000-000000000006",
};
const passphrase = "synthetic draft passphrase";
const secret = "尚未提交的周期审查总结：第三章仍有薄弱点";
const scope: FormDraftScope = {
  kind: "audit_review_summary",
  spaceId: ids.space,
  targetId: ids.review,
  userId: ids.user,
  workspaceId: ids.workspace,
};

let database: LogionOfflineDatabase | undefined;

afterEach(async () => {
  database?.close();
  await database?.delete();
  database = undefined;
});

async function unlocked() {
  database = await openOfflineDatabase({
    databaseName: `logion-drafts-${crypto.randomUUID()}`,
    indexedDB,
    IDBKeyRange,
  });
  const vault = new OfflineVault(database);
  await vault.initialize(ids.user, passphrase);
  return { db: database, vault, store: new FormDraftStore(database, vault) };
}

describe("encrypted form drafts", () => {
  it("derives stable draft IDs that never collide with other Vault records", () => {
    const id = formDraftId(scope);
    expect(id).toBe(formDraftId({ ...scope }));
    expect(id).not.toBe(formDraftId({ ...scope, targetId: null }));
    expect(id).not.toBe(formDraftId({ ...scope, kind: "research_claim" }));
    expect(isFormDraftId(id)).toBe(true);
    expect(isFormDraftId(noteDocumentStateId(ids.workspace, ids.note))).toBe(
      false,
    );
    expect(isFormDraftId(crypto.randomUUID())).toBe(false);
    expect(isFormDraftId(ids.note)).toBe(false);
  });

  it("seals, restores and stores no plaintext", async () => {
    const { db, store } = await unlocked();
    expect(await store.save(scope, { summary: secret })).toBe(true);
    const raw = JSON.stringify(await db.vaultRecords.toArray());
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("audit_review_summary");
    expect(await store.load(scope)).toMatchObject({
      values: { summary: secret },
    });
    expect(await store.load({ ...scope, targetId: null })).toBeNull();
  });

  it("rejects a draft opened under another Workspace", async () => {
    const { store, vault } = await unlocked();
    await store.save(scope, { summary: secret });
    await expect(
      vault.get(formDraftId(scope), ids.otherWorkspace),
    ).rejects.toThrow();
  });

  it("writes and reads nothing while the Vault is locked", async () => {
    const { db, store, vault } = await unlocked();
    vault.lock();
    expect(await store.save(scope, { summary: secret })).toBe(false);
    expect(await db.vaultRecords.count()).toBe(0);
    await vault.unlock(ids.user, passphrase);
    await store.save(scope, { summary: secret });
    vault.lock();
    expect(await store.load(scope)).toBeNull();
    expect(await db.vaultRecords.count()).toBe(1);
  });

  it("removes drafts on discard, empty input and expiry", async () => {
    const { db, store } = await unlocked();
    await store.save(scope, { summary: secret });
    await store.discard(scope);
    expect(await db.vaultRecords.count()).toBe(0);
    await store.save(scope, { summary: secret });
    await store.save(scope, { summary: "   " });
    expect(await db.vaultRecords.count()).toBe(0);
    await store.save(scope, { summary: secret });
    const later = Date.now() + FORM_DRAFT_TTL_MS + 1;
    expect(await store.purgeExpired(Date.now())).toBe(0);
    expect(await store.load(scope, later)).toBeNull();
    expect(await db.vaultRecords.count()).toBe(0);
    await store.save(scope, { summary: secret });
    expect(await store.purgeExpired(Date.now() + FORM_DRAFT_TTL_MS)).toBe(1);
  });

  it("clears only drafts on logout and everything on wipe", async () => {
    const { db, store, vault } = await unlocked();
    await vault.put(ids.note, ids.workspace, { title: "kept" });
    await store.save(scope, { summary: secret });
    await store.save(
      { ...scope, kind: "research_claim", targetId: null },
      { claim: secret },
    );
    vault.lock();
    expect(await clearFormDrafts(db)).toBe(2);
    expect(
      (await db.vaultRecords.toArray()).map((record) => record.record_id),
    ).toEqual([ids.note]);
    await vault.unlock(ids.user, passphrase);
    await store.save(scope, { summary: secret });
    await vault.wipeLocalData();
    expect(await db.vaultRecords.count()).toBe(0);
  });
});
