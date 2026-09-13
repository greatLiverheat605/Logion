"use client";

import { useRef, useState } from "react";
import { AppModal } from "./app-modal";

export type ConfirmationAction = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

export function AppConfirmModal({
  action,
  onClose,
  onConfirmed,
  errorText,
}: {
  action: ConfirmationAction;
  onClose: () => void;
  onConfirmed?: () => void;
  errorText: (error: unknown) => string;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await action.run();
      onConfirmed?.();
      onClose();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <AppModal
      title={action.title}
      eyebrow="操作确认"
      busy={pending}
      onClose={() => {
        if (!busy.current) onClose();
      }}
    >
      <p>{action.description}</p>
      {error ? (
        <p role="alert" className="form-message form-error">
          {error}
        </p>
      ) : null}
      <p role="status">{pending ? "正在处理，请勿重复提交…" : ""}</p>
      <div className="app-modal-actions">
        <button
          type="button"
          className="app-secondary-link"
          data-modal-autofocus
          disabled={pending}
          onClick={onClose}
        >
          取消
        </button>
        <button
          type="button"
          className="app-secondary-link"
          style={{
            color: "var(--text-danger)",
            background: "var(--bg-surface)",
            borderColor: "var(--text-danger)",
          }}
          disabled={pending}
          onClick={() => void confirm()}
        >
          {pending ? "正在处理…" : action.confirmLabel}
        </button>
      </div>
    </AppModal>
  );
}
