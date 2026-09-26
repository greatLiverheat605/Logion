import { v5 as uuidv5 } from "uuid";

import { LogionOfflineDatabase } from "./database";
import type { JsonObject } from "./types";
import { validateUuid } from "./validation";
import { OfflineVault } from "./vault";

// ADR-0034: unsubmitted form input sealed as Vault records. Drafts never sync.
export const FORM_DRAFT_KINDS = [
  "goal_create",
  "audit_review_summary",
  "quiz_item_explanation",
  "research_claim",
] as const;
export type FormDraftKind = (typeof FORM_DRAFT_KINDS)[number];
export const FORM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
// Version 8 plus a fixed first group: existing Vault records are v4, v5 or v7,
// so drafts are recognisable for deletion without decrypting anything.
const MARKER = "f0d4af75";

export interface FormDraftScope {
  kind: FormDraftKind;
  spaceId: string;
  targetId: string | null;
  userId: string;
  workspaceId: string;
}

export interface FormDraft {
  savedAt: string;
  values: Record<string, string>;
}

export function formDraftId(scope: FormDraftScope): string {
  validateUuid(scope.userId);
  validateUuid(scope.workspaceId);
  validateUuid(scope.spaceId);
  if (scope.targetId !== null) validateUuid(scope.targetId);
  if (!FORM_DRAFT_KINDS.includes(scope.kind)) throw new Error("form kind");
  const base = uuidv5(
    `logion:form-draft:${scope.userId}:${scope.kind}:${scope.workspaceId}:${scope.spaceId}:${scope.targetId ?? ""}`,
    NAMESPACE,
  );
  return `${MARKER}-${base.slice(9, 13)}-8${base.slice(15)}`;
}

export function isFormDraftId(recordId: string): boolean {
  return recordId.startsWith(`${MARKER}-`) && recordId[14] === "8";
}

function expired(updatedAt: string, now: number): boolean {
  const saved = Date.parse(updatedAt);
  return !Number.isFinite(saved) || now - saved >= FORM_DRAFT_TTL_MS;
}

function onlyStrings(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const entries = Object.entries(value);
  return entries.every(([, item]) => typeof item === "string")
    ? Object.fromEntries(entries)
    : null;
}

export class FormDraftStore {
  constructor(
    private readonly database: LogionOfflineDatabase,
    private readonly vault: OfflineVault,
  ) {}

  /** Seal the draft; a locked Vault writes nothing. Empty input removes it. */
  async save(
    scope: FormDraftScope,
    values: Record<string, string>,
  ): Promise<boolean> {
    if (!this.vault.unlocked) return false;
    const id = formDraftId(scope);
    if (Object.values(values).every((value) => value.trim() === "")) {
      await this.database.vaultRecords.delete(id);
      return true;
    }
    const payload: JsonObject = {
      kind: scope.kind,
      space_id: scope.spaceId,
      target_id: scope.targetId,
      values,
    };
    await this.database.vaultRecords.put(
      await this.vault.seal(id, scope.workspaceId, payload),
    );
    return true;
  }

  /** Open a draft for this exact scope; expired or mismatched drafts are removed. */
  async load(
    scope: FormDraftScope,
    now = Date.now(),
  ): Promise<FormDraft | null> {
    if (!this.vault.unlocked) return null;
    const id = formDraftId(scope);
    const record = await this.database.vaultRecords.get(id);
    if (!record) return null;
    if (
      record.workspace_id !== scope.workspaceId ||
      expired(record.updated_at, now)
    ) {
      await this.database.vaultRecords.delete(id);
      return null;
    }
    const payload = await this.vault.get(id, scope.workspaceId);
    const values = onlyStrings(payload?.values);
    if (
      !payload ||
      !values ||
      payload.kind !== scope.kind ||
      payload.space_id !== scope.spaceId ||
      payload.target_id !== scope.targetId
    ) {
      await this.database.vaultRecords.delete(id);
      return null;
    }
    return { savedAt: record.updated_at, values };
  }

  async discard(scope: FormDraftScope): Promise<void> {
    await this.database.vaultRecords.delete(formDraftId(scope));
  }

  /** Remove expired drafts without the key; returns the number removed. */
  async purgeExpired(now = Date.now()): Promise<number> {
    const stale = await this.database.vaultRecords
      .where("record_id")
      .startsWith(`${MARKER}-`)
      .filter(
        (record) =>
          isFormDraftId(record.record_id) && expired(record.updated_at, now),
      )
      .primaryKeys();
    await this.database.vaultRecords.bulkDelete(stale);
    return stale.length;
  }
}

/** Logout: delete every draft of this database; no key is required. */
export async function clearFormDrafts(
  database: LogionOfflineDatabase,
): Promise<number> {
  const ids = await database.vaultRecords
    .where("record_id")
    .startsWith(`${MARKER}-`)
    .filter((record) => isFormDraftId(record.record_id))
    .primaryKeys();
  await database.vaultRecords.bulkDelete(ids);
  return ids.length;
}
