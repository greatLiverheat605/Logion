/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { browserApiClient, LogionApiError } from "@/lib/api/client";
import type { DataExport } from "@/features/integrations/integration-capability-model";
import { ExportDownload } from "./export-download";

const epoch = Date.parse("2026-09-21T00:00:00Z");
const item = {
  id: "export-a",
  workspace_id: "workspace-a",
  status: "succeeded",
  expires_at: new Date(epoch + 1000).toISOString(),
} as DataExport;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  vi.spyOn(browserApiClient, "request").mockRejectedValue(
    new Error("Unexpected request"),
  );
  const NativeURL = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static override createObjectURL = vi.fn(() => "blob:synthetic");
      static override revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    () => undefined,
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("disables at the exact deadline while open and rechecks clock changes on focus", async () => {
  const tree = render(<ExportDownload item={item} />);
  const button = screen.getByRole<HTMLButtonElement>("button", {
    name: "下载 ZIP",
  });
  expect(button.disabled).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(button.disabled).toBe(true);
  expect(screen.getByText("已过期，请重新创建导出。")).toBeTruthy();
  vi.setSystemTime(epoch);
  tree.rerender(<ExportDownload item={{ ...item, id: "export-b" }} />);
  expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(false);
  vi.setSystemTime(epoch + 2000);
  fireEvent.focus(window);
  expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
});

it.each([null, "invalid-date"])(
  "never offers a download with unverified expiry %s",
  (expires_at) => {
    render(<ExportDownload item={{ ...item, expires_at } as DataExport} />);
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
    expect(browserApiClient.request).not.toHaveBeenCalled();
  },
);

it("downloads once with the server filename and releases the Blob URL", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(browserApiClient.request).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ExportDownload item={item} />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button"));
  expect(browserApiClient.request).toHaveBeenCalledTimes(1);
  const filename: string[] = [];
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename.push(this.download);
  });
  await act(async () =>
    finish({ blob: new Blob(["zip"]), filename: "logion-export-server.zip" }),
  );
  expect(filename).toEqual(["logion-export-server.zip"]);
  expect(window.location.pathname).toBe("/");
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});

it.each([false, true])(
  "discards late download success or failure after changing workspace (failure=%s)",
  async (failure) => {
    let finish!: (value: unknown) => void, reject!: (value: unknown) => void;
    vi.mocked(browserApiClient.request).mockReturnValue(
      new Promise((resolve, fail) => {
        finish = resolve;
        reject = fail;
      }),
    );
    const tree = render(<ExportDownload item={item} />);
    fireEvent.click(screen.getByRole("button"));
    const signal = vi.mocked(browserApiClient.request).mock.calls[0]![1]
      ?.signal;
    tree.rerender(
      <ExportDownload item={{ ...item, workspace_id: "workspace-b" }} />,
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      if (failure) reject(new Error("old"));
      else finish({ blob: new Blob(["zip"]), filename: "old.zip" });
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(false);
  },
);

it.each([
  [404, "EXPORT_NOT_FOUND", "导出已不可用"],
  [403, "AUTH_RECENT_LOGIN_REQUIRED", "下载需要近期认证"],
  [401, "AUTH_INVALID_SESSION", "会话需要恢复"],
])(
  "keeps %s %s failures in the app without creating a file",
  async (status, code, message) => {
    vi.mocked(browserApiClient.request).mockRejectedValue(
      new LogionApiError({ status, code, message: "private detail" }),
    );
    render(<ExportDownload item={item} />);
    await act(async () => fireEvent.click(screen.getByRole("button")));
    expect(screen.getByRole("status").textContent).toContain(message);
    expect(screen.getByRole("status").textContent).not.toContain(
      "private detail",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    if (status === 403)
      expect(screen.getByRole("link", { name: "重新登录" })).toBeTruthy();
  },
);
