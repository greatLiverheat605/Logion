/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { OfflineStorageError } from "@logion/offline";

import { FeedbackProvider } from "@/components/feedback/feedback-provider";
import { LogionApiError } from "@/lib/api/client";
import { feedback, feedbackErrorText } from "./feedback";

afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.restoreAllMocks();
});

describe("transient feedback policy", () => {
  it("mounts the real Sonner live region and a manually dismissible error", async () => {
    render(<FeedbackProvider />);
    act(() => {
      feedback.error("上传失败 KNOWLEDGE_ATTACHMENT_INGEST_DISABLED");
    });
    await screen.findByText("上传失败 KNOWLEDGE_ATTACHMENT_INGEST_DISABLED");
    expect(
      document
        .querySelector("[data-sonner-toaster]")
        ?.closest('[aria-live="polite"]'),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭反馈" })).toBeTruthy();
    const latest = toast.getToasts().at(-1);
    expect(latest && "duration" in latest ? latest.duration : undefined).toBe(
      Infinity,
    );
  });
  it("success lasts 3 seconds and pending returns its own dismiss function", async () => {
    const success = vi.spyOn(toast, "success");
    expect(feedback.success("已同步")).toBe("已同步");
    expect(success).toHaveBeenCalledWith("已同步", { duration: 3000 });
    const dismiss = vi.spyOn(toast, "dismiss");
    const done = feedback.pending("同步中");
    const id = toast.getToasts().at(-1)?.id;
    done();
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(id));
  });
  it("only unwraps safe diagnostic fields, not raw error messages or details", () => {
    const error = new OfflineStorageError(
      "OFFLINE_TRANSACTION_FAILED",
      true,
      new LogionApiError({
        code: "WEB_NETWORK_UNAVAILABLE",
        status: 503,
        requestId: "test-request",
        message: "secret",
        details: { secret: "private" },
      }),
    );
    expect(feedbackErrorText(error)).toBe(
      "操作未完成，请稍后重试。（WEB_NETWORK_UNAVAILABLE）（请求编号：test-request）",
    );
    expect(feedbackErrorText(new Error("secret"))).not.toContain("secret");
  });
});
