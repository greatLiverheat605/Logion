"use client";

import { toast } from "sonner";
import { OfflineStorageError } from "@logion/offline";

import { LogionApiError } from "@/lib/api/client";

// Accept preformatted, public messages; never echo Error.message or details.
export function feedbackErrorText(
  error: unknown,
  fallback = "操作未完成，请稍后重试。",
  options?: { requestId?: string },
): string {
  if (error instanceof OfflineStorageError) {
    // SyncClient wraps transport failures; only unwrap the known public API error.
    if (error.cause instanceof LogionApiError)
      return feedbackErrorText(error.cause, fallback, options);
    return `${fallback}（${error.code}）`;
  }
  const text = typeof error === "string" ? error : fallback;
  const requestId =
    options?.requestId ??
    (error instanceof LogionApiError ? error.requestId : undefined);
  return `${text}${error instanceof LogionApiError ? `（${error.code}）` : ""}${requestId ? `（请求编号：${requestId}）` : ""}`;
}

export const feedback = {
  success(text: string): string {
    toast.success(text, { duration: 3000 });
    return text;
  },
  error(error: unknown, options?: { requestId?: string }): string {
    const text = feedbackErrorText(error, undefined, options);
    toast.error(text, { duration: Infinity, closeButton: true });
    return text;
  },
  pending(text: string): () => void {
    const id = toast.loading(text, { duration: Infinity });
    return () => {
      toast.dismiss(id);
    };
  },
};
