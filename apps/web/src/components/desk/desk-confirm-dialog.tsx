"use client";

import { type ReactNode, type RefObject, useId, useState } from "react";

import { AppModal } from "@/components/app-shell/app-modal";
import { DeskButton, DeskInput } from "@/components/desk/desk-primitives";

interface DeskConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen if the user confirms — shown in a bordered preview box. */
  impact: ReactNode;
  /** Recovery / rollback path description shown after confirmation impact. */
  recoveryNote?: ReactNode;
  /**
   * When set, the user must type this exact phrase before the confirm button
   * enables. Use for destructive (irreversible) actions.
   */
  requireTypedPhrase?: string;
  /**
   * If `true`, the confirm button is disabled and shows a prompt to
   * re-authenticate. The component never fabricates authentication success —
   * the caller must set this to `false` only after a real re-authentication.
   * Defaults to `false` (no auth requirement).
   */
  requiresRecentAuth?: boolean;
  /** Human-readable note about the recent-auth requirement (e.g. reason). */
  recentAuthNote?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Disable the confirm button because the action is in-flight (pending). */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Ref of the element that should regain focus when the dialog closes. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * D2 danger-confirmation overlay. Built on the already-validated `AppModal`
 * (focus enter, Tab trap, Escape, focus return) and adds the four D2 danger
 * requirements: impact preview, optional typed-phrase gate, explicit
 * recent-auth gate, and a recovery-path description.
 *
 * When `busy` is true the dialog cannot be dismissed by any means — cancel,
 * close icon, Escape and background click are all suppressed so an in-flight
 * destructive action cannot be interrupted or bypassed.
 *
 * The component never fabricates authentication: if `requiresRecentAuth` is
 * true the confirm button stays disabled until the caller flips it to false
 * after a genuine re-authentication.
 */
export function DeskConfirmDialog({
  busy = false,
  cancelLabel = "取消",
  confirmLabel = "确认",
  impact,
  onCancel,
  onConfirm,
  open,
  recentAuthNote,
  recoveryNote,
  requireTypedPhrase,
  requiresRecentAuth = false,
  returnFocusRef,
  title,
}: Readonly<DeskConfirmDialogProps>) {
  const [typed, setTyped] = useState("");
  const phraseRequired = Boolean(requireTypedPhrase);
  const phraseMatches = !phraseRequired || typed === requireTypedPhrase;
  const inputId = useId();

  // Reset the typed phrase whenever the dialog opens, or whenever the required
  // phrase changes (a stale typed value from a different confirmation must not
  // enable the confirm button). This is a legitimate "sync state to prop
  // change" case — React docs note resetting on prop change is a valid effect
  // use when the prop is the source of truth for the reset moment.
  useResetOnOpen(open, requireTypedPhrase, setTyped);

  if (!open) return null;

  // When busy, the action is in flight: no dismiss path may bypass the
  // pending state. We route both cancel and modal-close through a guard.
  const guardedCancel = busy ? undefined : onCancel;

  const authBlocked = requiresRecentAuth;
  const confirmDisabled = busy || !phraseMatches || authBlocked;

  return (
    <AppModal
      eyebrow="确认操作"
      onClose={guardedCancel ?? noop}
      returnFocusRef={returnFocusRef}
      title={title}
    >
      <div className="desk-confirm-impact">
        <strong>影响范围</strong>
        <div>{impact}</div>
        {recoveryNote ? (
          <div className="desk-confirm-recent-auth">{recoveryNote}</div>
        ) : null}
      </div>
      {phraseRequired ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <p className="desk-confirm-phrase">
            请输入 <code>{requireTypedPhrase}</code> 以确认。
          </p>
          <label className="sr-only" htmlFor={inputId}>
            确认短语
          </label>
          <DeskInput
            aria-invalid={!phraseMatches || undefined}
            autoComplete="off"
            data-modal-autofocus={phraseRequired ? "" : undefined}
            disabled={busy}
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
          />
        </div>
      ) : null}
      {authBlocked ? (
        <div className="desk-confirm-auth-blocked" role="status">
          <strong>需要重新认证</strong>
          {recentAuthNote ? <span>{recentAuthNote}</span> : null}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-2)",
          marginTop: "var(--space-3)",
        }}
      >
        <DeskButton
          disabled={busy}
          onClick={guardedCancel ?? noop}
          tone="ghost"
        >
          {cancelLabel}
        </DeskButton>
        <DeskButton
          aria-busy={busy || undefined}
          disabled={confirmDisabled}
          onClick={onConfirm}
          tone="bad"
        >
          {busy ? "正在处理…" : authBlocked ? "需重新认证" : confirmLabel}
        </DeskButton>
      </div>
    </AppModal>
  );
}

function noop() {
  /* no-op: used to neutralise onClose when busy */
}

/**
 * Resets `typed` to empty whenever the dialog transitions from closed to open,
 * or whenever the required phrase changes while open. Implemented as a tiny
 * hook so the effect lint exception is scoped and documented.
 */
function useResetOnOpen(
  open: boolean,
  phrase: string | undefined,
  setTyped: (value: string) => void,
) {
  // Track the previous open state and phrase to detect transitions.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevPhrase, setPrevPhrase] = useState(phrase);
  if (open !== prevOpen || phrase !== prevPhrase) {
    setPrevOpen(open);
    setPrevPhrase(phrase);
    if (open) setTyped("");
  }
}
