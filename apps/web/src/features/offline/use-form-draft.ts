"use client";

import {
  FormDraftStore,
  type FormDraft,
  type FormDraftKind,
  type FormDraftScope,
} from "@logion/offline";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOptionalSession } from "@/features/auth/session-provider";
import { useOptionalVaultSession } from "@/features/offline/vault-session-provider";

const SAVE_DELAY_MS = 2000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface FormDraftController {
  /** A sealed draft for this form and context, awaiting Restore or Discard. */
  pending: FormDraft | null;
  discard: () => Promise<void>;
  /** Debounced; nothing is written while the Vault is locked. */
  record: (values: Record<string, string>) => void;
  restore: () => Record<string, string> | null;
  /** Call after a successful submit. */
  submitted: () => Promise<void>;
}

/**
 * ADR-0034: keep long unsubmitted input of an allowlisted form as a sealed
 * Vault record. Drafts are never restored silently, submitted or synced.
 */
export function useFormDraft(input: {
  kind: FormDraftKind;
  open: boolean;
  spaceId: string;
  targetId?: string | null;
  workspaceId: string;
}): FormDraftController {
  const session = useOptionalSession();
  const vaultSession = useOptionalVaultSession();
  const userId =
    session?.state.status === "authenticated" ? session.state.user.id : "";
  const database = vaultSession?.activeDatabase ?? null;
  const vault = vaultSession?.activeVault ?? null;
  const unlocked = vaultSession?.phase === "unlocked";
  const targetId = input.targetId ?? null;
  const scope = useMemo<FormDraftScope | null>(
    () =>
      [userId, input.workspaceId, input.spaceId].every((id) => uuid.test(id)) &&
      (targetId === null || uuid.test(targetId))
        ? {
            kind: input.kind,
            spaceId: input.spaceId,
            targetId,
            userId,
            workspaceId: input.workspaceId,
          }
        : null,
    [input.kind, input.spaceId, input.workspaceId, targetId, userId],
  );
  const store = useMemo(
    () =>
      database && vault && unlocked
        ? new FormDraftStore(database, vault)
        : null,
    [database, unlocked, vault],
  );
  const [pending, setPending] = useState<FormDraft | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<Record<string, string> | null>(null);
  const active = useRef({ scope, store });
  useEffect(() => {
    active.current = { scope, store };
  }, [scope, store]);

  const flush = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const values = latest.current;
    const { scope: current, store: currentStore } = active.current;
    latest.current = null;
    if (!values || !current || !currentStore) return;
    await currentStore.save(current, values).catch(() => false);
  }, []);

  useEffect(() => {
    // Offer the draft once per opening, after the Vault is unlocked.
    if (!input.open || !scope || !store) {
      queueMicrotask(() => setPending(null));
      return;
    }
    let current = true;
    void store
      .purgeExpired()
      .then(() => store.load(scope))
      .then(
        (draft) => {
          if (current) setPending(draft);
        },
        () => {
          if (current) setPending(null);
        },
      );
    return () => {
      current = false;
    };
  }, [input.open, scope, store]);

  useEffect(() => {
    if (!input.open) return;
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      void flush();
    };
  }, [flush, input.open]);

  const record = useCallback(
    (values: Record<string, string>) => {
      latest.current = values;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const restore = useCallback(() => {
    const values = pending?.values ?? null;
    setPending(null);
    return values;
  }, [pending]);

  const forget = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
    setPending(null);
    const { scope: current, store: currentStore } = active.current;
    if (current && currentStore)
      await currentStore.discard(current).catch(() => undefined);
  }, []);

  return { discard: forget, pending, record, restore, submitted: forget };
}

/** Values of the named fields of an uncontrolled form. */
export function formDraftValues(
  form: HTMLFormElement,
  fields: readonly string[],
): Record<string, string> {
  const data = new FormData(form);
  return Object.fromEntries(
    fields.map((field) => [field, String(data.get(field) ?? "")]),
  );
}

/** Write restored values into the named fields of an uncontrolled form. */
export function applyFormDraft(
  form: HTMLFormElement | null,
  values: Record<string, string> | null,
): void {
  if (!form || !values) return;
  for (const [field, value] of Object.entries(values)) {
    const element = form.elements.namedItem(field);
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    )
      element.value = value;
  }
}
