"use client";

import type { FormDraft } from "@logion/offline";

function savedLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "之前"
    : date.toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** ADR-0034: a sealed draft is only ever restored by an explicit choice. */
export function FormDraftPrompt({
  draft,
  onDiscard,
  onRestore,
}: Readonly<{
  draft: FormDraft | null;
  onDiscard: () => void;
  onRestore: () => void;
}>) {
  if (!draft) return null;
  return (
    <div className="form-draft-prompt" role="group" aria-label="未提交内容">
      <p>
        恢复未提交内容？本机在 {savedLabel(draft.savedAt)}{" "}
        加密保存了这张表单的草稿。
      </p>
      <div className="form-draft-prompt-actions">
        <button type="button" onClick={onRestore}>
          恢复
        </button>
        <button type="button" onClick={onDiscard}>
          丢弃
        </button>
      </div>
    </div>
  );
}
