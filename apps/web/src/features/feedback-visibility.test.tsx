/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineStorageError } from "@logion/offline";
import { toast } from "sonner";

import { browserApiClient, LogionApiError } from "@/lib/api/client";
import { ExamCenter } from "./exam/exam-center";
import { ReviewCenter } from "./memory/review-center";
import { SelfStudyCenter } from "./self-study/self-study-center";

const mocks = vi.hoisted(() => ({
  synchronize: vi.fn(),
  commit: vi.fn(),
  vaultSession: {} as Record<string, unknown>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));
vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vaultSession,
}));
vi.mock("@logion/offline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@logion/offline")>();
  return {
    ...actual,
    SyncClient: class {
      synchronize = mocks.synchronize;
    },
    ProtectedOfflineRepository: class {
      commitMutation = mocks.commit;
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.synchronize.mockResolvedValue({ pushed: 1, pulled: 1, control: null });
  mocks.commit.mockResolvedValue(undefined);
  window.sessionStorage.clear();
  const collection = {
    toArray: async () => [],
    count: async () => 0,
    last: async () => undefined,
  };
  const table = {
    where: () => ({ equals: () => collection }),
    filter: () => collection,
  };
  Object.assign(mocks.vaultSession, {
    database: {
      current: {
        entities: table,
        conflicts: table,
        outbox: table,
        syncState: {
          get: async () => ({
            bootstrap_state: "ready",
            device_id: "device-1",
          }),
        },
      },
    },
    vault: { current: {} },
    phase: "unlocked",
    revision: 1,
  });
  vi.spyOn(browserApiClient, "request").mockImplementation(
    async <T,>(path: string): Promise<T> => {
      if (path === "/api/v1/workspaces")
        return {
          workspaces: [
            { id: "workspace-1", name: "Test workspace", role: "owner" },
          ],
        } as T;
      if (path === "/api/v1/auth/devices")
        return { devices: [{ id: "device-1", current: true }] } as T;
      if (path.endsWith("/spaces"))
        return {
          spaces: [
            { id: "space-1", name: "Test space", visibility: "private" },
          ],
        } as T;
      throw new Error(`Unexpected request: ${path}`);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Module = "review" | "exam" | "self-study";
async function create(module: Module) {
  window.history.replaceState({}, "", `/app/${module}`);
  render(
    module === "exam" ? (
      <ExamCenter />
    ) : module === "review" ? (
      <ReviewCenter />
    ) : (
      <SelfStudyCenter />
    ),
  );
  await waitFor(() =>
    expect(document.body.textContent).toContain("已在应用内解锁"),
  );
  await waitFor(() =>
    expect(document.body.textContent).toContain("Test space"),
  );
  if (module === "exam") {
    fireEvent.click(screen.getByTestId("exam-create"));
    fireEvent.change(screen.getByLabelText("考试名称"), {
      target: { value: "Feedback exam" },
    });
    fireEvent.click(screen.getByLabelText("日期待定"));
  } else if (module === "self-study") {
    fireEvent.click(screen.getByRole("button", { name: "快速收集" }));
    fireEvent.change(screen.getByLabelText("想法或资料标题"), {
      target: { value: "Feedback idea" },
    });
  } else {
    const tab = screen.getByRole("tab", { name: /周期审查/ });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("button", { name: "创建审查" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-11-01" },
    });
  }
  const dialog = screen.getByRole("dialog");
  fireEvent.submit(dialog.querySelector("form")!);
  await waitFor(() => expect(mocks.commit).toHaveBeenCalledTimes(1));
}

describe("F1/F2/F3 center feedback control flow", () => {
  it.each<Module>(["self-study", "exam", "review"])(
    "%s reports a completed synchronization in both layers",
    async (module) => {
      await create(module);
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          expect.stringContaining("已同步"),
          { duration: 3000 },
        ),
      );
      expect(toast.error).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.body.textContent).toContain("已同步");
    },
  );

  it.each<Module>(["self-study", "exam", "review"])(
    "%s preserves a wrapped HTTP 503 failure after local commit and closes the committed form",
    async (module) => {
      mocks.synchronize.mockRejectedValue(
        new OfflineStorageError(
          "OFFLINE_TRANSACTION_FAILED",
          true,
          new LogionApiError({
            code: "T03_SYNC_UNAVAILABLE",
            status: 503,
            requestId: "request-t03-sync",
            message: "Private transport detail",
          }),
        ),
      );
      await create(module);
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("T03_SYNC_UNAVAILABLE"),
          { duration: Infinity, closeButton: true },
        ),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const inline = [...document.querySelectorAll('[aria-live="polite"]')]
        .map((node) => node.textContent)
        .join(" ");
      expect(inline).toContain("T03_SYNC_UNAVAILABLE");
      expect(inline).toContain("request-t03-sync");
      expect(inline).not.toContain("已加密保存");
      expect(inline).not.toContain("Private transport detail");
      expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it("F2 retains exam inputs and shows local commit failure inside the Sheet", async () => {
    mocks.commit.mockRejectedValue(
      new OfflineStorageError("OFFLINE_QUOTA_EXCEEDED"),
    );
    await create("exam");
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain(
        "OFFLINE_QUOTA_EXCEEDED",
      ),
    );
    expect((screen.getByLabelText("考试名称") as HTMLInputElement).value).toBe(
      "Feedback exam",
    );
    expect(mocks.synchronize).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
