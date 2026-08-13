/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DeskConflictResolver,
  DeskInlineError,
  DeskProgress,
  DeskRequestId,
  DeskSkeleton,
  DeskToast,
} from "@/components/desk/desk-feedback";

afterEach(cleanup);

describe("DeskInlineError", () => {
  it("surfaces message, code and request id", () => {
    render(
      <DeskInlineError
        code="INVITATION_CONFLICT"
        message="该邮箱已是成员"
        requestId="req-99"
      />,
    );
    expect(screen.getByText("该邮箱已是成员")).toBeDefined();
    expect(screen.getByText(/INVITATION_CONFLICT/)).toBeDefined();
    expect(screen.getByText(/req-99/)).toBeDefined();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    render(<DeskInlineError message="失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("uses alert role so screen readers announce the error", () => {
    const { container } = render(<DeskInlineError message="失败" />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("renders the help entry as a real anchor link (not a button wrapping an anchor)", () => {
    const { container } = render(
      <DeskInlineError helpHref="https://help.example.com/x" message="失败" />,
    );
    // The help entry must be an <a>, and must NOT be nested inside a <button>.
    const anchor = container.querySelector(
      "a.desk-inline-error-help",
    ) as HTMLAnchorElement | null;
    expect(anchor).not.toBeNull();
    expect(anchor!.tagName).toBe("A");
    expect(anchor!.getAttribute("href")).toBe("https://help.example.com/x");
    // No <button> ancestor for the anchor — no nested interactive elements.
    expect(anchor!.closest("button")).toBeNull();
  });
});

describe("DeskSkeleton", () => {
  it("renders a labelled placeholder with the label stored for a11y", () => {
    const { container } = render(<DeskSkeleton height="2rem" label="加载中" />);
    const skeleton = container.querySelector(
      ".desk-skeleton",
    ) as HTMLElement | null;
    expect(skeleton).not.toBeNull();
    expect(skeleton!.getAttribute("data-label")).toBe("加载中");
  });
});

describe("DeskProgress", () => {
  it("clamps value to 0-100 and exposes aria-valuenow", () => {
    render(<DeskProgress label="同步" value={150} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
  });

  it("clamps negative values to 0", () => {
    render(<DeskProgress label="同步" value={-5} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "0",
    );
  });
});

describe("DeskRequestId", () => {
  it("renders the request id", () => {
    render(<DeskRequestId requestId="abc-123" />);
    expect(screen.getByText(/abc-123/)).toBeDefined();
  });
});

describe("DeskToast", () => {
  it("renders title and detail with status role for non-bad tone", () => {
    const { container } = render(
      <DeskToast detail="已保存" title="成功" tone="good" />,
    );
    const toast = container.querySelector(".desk-toast") as HTMLElement;
    expect(toast).not.toBeNull();
    expect(toast.getAttribute("role")).toBe("status");
    expect(screen.getByText("已保存")).toBeDefined();
  });

  it("uses alert role for bad tone", () => {
    const { container } = render(<DeskToast title="失败" tone="bad" />);
    const toast = container.querySelector(".desk-toast") as HTMLElement;
    expect(toast.getAttribute("role")).toBe("alert");
  });

  it("triggers onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<DeskToast onClose={onClose} title="通知" tone="info" />);
    fireEvent.click(screen.getByLabelText("关闭通知"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("DeskConflictResolver", () => {
  it("renders detail, request id and action buttons; calls action onClick", () => {
    const reload = vi.fn();
    render(
      <DeskConflictResolver
        actions={[{ kind: "reload", label: "重新加载", onClick: reload }]}
        detail="远端版本较新"
        requestId="req-7"
      />,
    );
    expect(screen.getByText("远端版本较新")).toBeDefined();
    expect(screen.getByText(/req-7/)).toBeDefined();
    fireEvent.click(screen.getByText("重新加载"));
    expect(reload).toHaveBeenCalledOnce();
  });
});
