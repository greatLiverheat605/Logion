/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type {
  AttachmentQueueEntry,
  LogionOfflineDatabase,
} from "@logion/offline";
import { SyncClient } from "@logion/offline";

import {
  browserApiClient,
  LogionApiError,
  type ApiClient,
} from "@/lib/api/client";

const mocks = vi.hoisted(() => ({
  vaultSession: {} as Record<string, unknown>,
}));

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: {
      status: "authenticated",
      user: { id: "00000000-0000-7000-8000-000000000006" },
    },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vaultSession,
}));

import { OfflineSyncCenter } from "./offline-sync-center";

const WORKSPACE_ID = "00000000-0000-7000-8000-000000000001";
const DEVICE_ID = "00000000-0000-7000-8000-000000000002";

interface FakeDatabaseState {
  rows: AttachmentQueueEntry[];
}

interface FakeDatabase {
  database: LogionOfflineDatabase;
  state: FakeDatabaseState;
}

function attachment(): AttachmentQueueEntry {
  return {
    attachment_id: "00000000-0000-7000-8000-000000000003",
    workspace_id: WORKSPACE_ID,
    space_id: "00000000-0000-7000-8000-000000000004",
    device_id: DEVICE_ID,
    target_type: "note",
    target_id: "00000000-0000-7000-8000-000000000005",
    filename: "research-notes.txt",
    media_type: "text/plain",
    byte_size: 14,
    sha256: `sha256:${"a".repeat(64)}`,
    state: "pending_upload",
    blob: new Blob(["research notes"], { type: "text/plain" }),
    queued_at: "2026-09-05T00:00:00.000Z",
    last_error_code: null,
    server_version: null,
  };
}

function createFakeDatabase(initial: AttachmentQueueEntry): FakeDatabase {
  const state: FakeDatabaseState = {
    rows: [{ ...initial }],
  };
  const attachmentQueue = {
    get: async (attachmentId: string) => {
      const row = state.rows.find(
        (candidate) => candidate.attachment_id === attachmentId,
      );
      return row ? { ...row } : undefined;
    },
    update: async (
      attachmentId: string,
      changes: Partial<AttachmentQueueEntry>,
    ) => {
      const index = state.rows.findIndex(
        (candidate) => candidate.attachment_id === attachmentId,
      );
      const row = state.rows[index];
      if (row === undefined) return 0;
      state.rows[index] = { ...row, ...changes };
      return 1;
    },
    delete: async (attachmentId: string) => {
      state.rows = state.rows.filter(
        (row) => row.attachment_id !== attachmentId,
      );
    },
    where: (index: string) => {
      if (index === "workspace_id") {
        return {
          equals: (workspaceId: string) => ({
            toArray: async () =>
              state.rows
                .filter((row) => row.workspace_id === workspaceId)
                .map((row) => ({ ...row })),
          }),
        };
      }
      if (index === "[workspace_id+state+queued_at]") {
        return {
          between: (lower: [string, string, string]) => ({
            first: async () => {
              const row = state.rows.find(
                (candidate) =>
                  candidate.workspace_id === lower[0] &&
                  candidate.state === lower[1],
              );
              return row ? { ...row } : undefined;
            },
          }),
        };
      }
      throw new Error(`Unexpected attachment index: ${index}`);
    },
  };
  const emptyWorkspaceTable = {
    where: () => ({
      equals: () => ({ toArray: async () => [] }),
    }),
  };
  const database = {
    transaction: async (
      _mode: string,
      _table: unknown,
      callback: () => Promise<void>,
    ) => callback(),
    attachmentQueue,
    conflicts: emptyWorkspaceTable,
    outbox: emptyWorkspaceTable,
    syncState: { get: async () => undefined },
  } as unknown as LogionOfflineDatabase;
  return { database, state };
}

function mockApi(
  attachmentRequest: (path: string) => unknown | Promise<unknown>,
) {
  const implementation: ApiClient["request"] = async <T,>(
    path: string,
  ): Promise<T> => {
    if (path === "/api/v1/workspaces") {
      return {
        workspaces: [
          {
            created_at: "2026-09-05T00:00:00.000Z",
            id: WORKSPACE_ID,
            membership_status: "active",
            name: "Logion",
            role: "owner",
            status: "active",
            updated_at: "2026-09-05T00:00:00.000Z",
            version: 1,
          },
        ],
      } as T;
    }
    if (path === "/api/v1/auth/devices") {
      return {
        devices: [
          {
            current: true,
            first_seen_at: "2026-09-05T00:00:00.000Z",
            id: DEVICE_ID,
            last_seen_at: "2026-09-05T00:00:00.000Z",
            name: "Test browser",
            platform: "web",
            revoked_at: null,
          },
        ],
      } as T;
    }
    return (await attachmentRequest(path)) as T;
  };
  return vi
    .spyOn(browserApiClient, "request")
    .mockImplementation(implementation);
}

async function renderReadyCenter(fake: FakeDatabase): Promise<void> {
  Object.assign(mocks.vaultSession, {
    clearLocalData: vi.fn(),
    database: { current: fake.database },
    lock: vi.fn(),
    phase: "unlocked",
    revision: 1,
    unlock: vi.fn(),
    vault: { current: {} },
  });
  render(<OfflineSyncCenter />);
  await waitFor(() => {
    expect(screen.getByTestId("sync-inspector").textContent).toContain(
      "本地资料已在应用内解锁。",
    );
  });
  const attachmentTab = screen.getByRole("tab", { name: /附件队列/ });
  fireEvent.mouseDown(attachmentTab, { button: 0, ctrlKey: false });
  await waitFor(() => {
    expect(attachmentTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("sync-attachments").textContent).toContain(
      "research-notes.txt",
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mocks.vaultSession)) {
    delete mocks.vaultSession[key];
  }
  window.history.replaceState({}, "", "/app/sync");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OfflineSyncCenter attachment upload feedback", () => {
  it("retries upgraded synchronization from the existing state without bootstrapping", async () => {
    const fake = createFakeDatabase(attachment());
    vi.spyOn(fake.database.syncState, "get").mockResolvedValue({
      workspace_id: WORKSPACE_ID,
      device_id: DEVICE_ID,
      schema_version: 4,
      sync_epoch: "00000000-0000-7000-8000-000000000008",
      cursor: 7,
      bootstrap_state: "upgrade_required",
      last_sync_at: null,
      outbox_isolated_at: null,
      isolation_reason_code: null,
    });
    const sync = vi
      .spyOn(SyncClient.prototype, "synchronize")
      .mockResolvedValue({
        pushed: 0,
        pulled: 0,
        has_more: false,
        control: "upgrade_required",
      });
    const unexpectedApi = vi.fn(() => {
      throw new Error("Bootstrap must not run");
    });
    mockApi(unexpectedApi);
    await renderReadyCenter(fake);
    fireEvent(window, new Event("online"));
    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));
    await waitFor(() =>
      expect(sync).toHaveBeenCalledWith(WORKSPACE_ID, DEVICE_ID),
    );
    expect(unexpectedApi).not.toHaveBeenCalled();
    expect(mocks.vaultSession.clearLocalData).not.toHaveBeenCalled();
  });
  it("removes only the confirmed failed attachment while offline without clearing the Vault or calling HTTP", async () => {
    const failed = { ...attachment(), state: "failed" as const };
    const fake = createFakeDatabase(failed);
    const keep = {
      ...attachment(),
      attachment_id: "00000000-0000-7000-8000-000000000007",
      filename: "keep.txt",
    };
    fake.state.rows.push(keep);
    const attachmentRequest = vi.fn();
    const api = mockApi(attachmentRequest);
    await renderReadyCenter(fake);
    fireEvent(window, new Event("offline"));
    api.mockClear();

    fireEvent.click(
      screen.getByRole("button", { name: "移除附件「research-notes.txt」" }),
    );
    expect(screen.getByRole("dialog", { name: "移除失败附件" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(fake.state.rows).toHaveLength(2);
    expect(toast.success).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "移除附件「research-notes.txt」" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "移除失败附件" })).toBeNull(),
    );
    expect(fake.state.rows).toEqual([keep]);
    expect(screen.getByTestId("sync-attachments").textContent).not.toContain(
      "research-notes.txt",
    );
    expect(screen.getByTestId("sync-attachments").textContent).toContain(
      "keep.txt",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "已从本设备队列移除附件「research-notes.txt」。",
      { duration: 3000 },
    );
    expect(mocks.vaultSession.clearLocalData).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps the row and confirmation visible when local removal fails", async () => {
    const fake = createFakeDatabase({ ...attachment(), state: "failed" });
    mockApi(vi.fn());
    await renderReadyCenter(fake);
    vi.spyOn(fake.database.attachmentQueue, "delete").mockRejectedValue(
      new Error("storage unavailable"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "移除附件「research-notes.txt」" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("操作未完成"),
    );
    expect(fake.state.rows).toHaveLength(1);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(mocks.vaultSession.clearLocalData).not.toHaveBeenCalled();
  });

  it.each(["retried", "removed"] as const)(
    "refreshes the queue and closes a stale confirmation after another tab %s the attachment",
    async (change) => {
      const fake = createFakeDatabase({ ...attachment(), state: "failed" });
      mockApi(vi.fn());
      await renderReadyCenter(fake);
      fireEvent.click(
        screen.getByRole("button", { name: "移除附件「research-notes.txt」" }),
      );
      fake.state.rows =
        change === "removed"
          ? []
          : [{ ...attachment(), state: "pending_upload" }];

      fireEvent.click(screen.getByRole("button", { name: "确认移除" }));

      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "移除失败附件" }),
        ).toBeNull(),
      );
      expect(
        screen.queryByRole("button", {
          name: "移除附件「research-notes.txt」",
        }),
      ).toBeNull();
      expect(screen.getByTestId("sync-inspector").textContent).toContain(
        "附件已不可移除，已重新读取当前队列。",
      );
      if (change === "retried") {
        expect(screen.getByRole("button", { name: "上传并验证" })).toBeTruthy();
        expect(fake.state.rows).toHaveLength(1);
      } else {
        expect(
          screen.getByTestId("sync-attachments").textContent,
        ).not.toContain("research-notes.txt");
      }
      expect(toast.success).not.toHaveBeenCalled();
      expect(mocks.vaultSession.clearLocalData).not.toHaveBeenCalled();
    },
  );

  it("uploads only the selected row and keeps its failure visible", async () => {
    const fake = createFakeDatabase(attachment());
    const keep = {
      ...attachment(),
      attachment_id: "00000000-0000-7000-8000-000000000007",
      filename: "keep.txt",
    };
    fake.state.rows.unshift(keep);
    const attachmentRequest = vi.fn().mockRejectedValue(
      new LogionApiError({
        code: "KNOWLEDGE_ATTACHMENT_INGEST_DISABLED",
        message: "Attachment ingest is disabled.",
        requestId: "request-upload-disabled",
        status: 404,
      }),
    );
    mockApi(attachmentRequest);
    await renderReadyCenter(fake);

    fireEvent.click(
      within(screen.getByText("research-notes.txt").closest("li")!).getByRole(
        "button",
        { name: "上传并验证" },
      ),
    );

    await waitFor(() => {
      const status = screen.getByTestId("sync-inspector").textContent ?? "";
      expect(status).toContain("research-notes.txt");
      expect(status).toContain("服务端附件功能当前未开放");
      expect(status).toContain("KNOWLEDGE_ATTACHMENT_INGEST_DISABLED");
      expect(status).toContain("request-upload-disabled");
    });
    expect(document.body.textContent).not.toContain("完成服务器哈希验证");
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("KNOWLEDGE_ATTACHMENT_INGEST_DISABLED"),
      { duration: Infinity, closeButton: true },
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "重试" })).toBeTruthy();
    expect(fake.state.rows[0]).toEqual(keep);
    expect(fake.state.rows[1]?.state).toBe("failed");
    expect(fake.state.rows[1]?.last_error_code).toBe(
      "OFFLINE_ATTACHMENT_UPLOAD_FAILED",
    );
  });

  it("reports verified success with the processed filename", async () => {
    const fake = createFakeDatabase(attachment());
    const attachmentRequest = vi.fn((path: string) => {
      if (path.endsWith("/init")) return { status: "pending", version: 1 };
      if (path.endsWith("/content")) return { status: "uploaded", version: 2 };
      if (path.endsWith("/complete")) {
        return { status: "verified", version: 3 };
      }
      throw new Error(`Unexpected attachment request: ${path}`);
    });
    mockApi(attachmentRequest);
    await renderReadyCenter(fake);

    fireEvent.click(screen.getByRole("button", { name: "上传并验证" }));

    await waitFor(() => {
      expect(screen.getByTestId("sync-inspector").textContent).toContain(
        "附件「research-notes.txt」上传成功，并完成服务器哈希验证。",
      );
    });
    expect(fake.state.rows[0]?.state).toBe("verified");
    expect(toast.success).toHaveBeenCalledWith(
      "附件「research-notes.txt」上传成功，并完成服务器哈希验证。",
      { duration: 3000 },
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(attachmentRequest).toHaveBeenCalledTimes(3);
  });

  it("reports an empty pending queue instead of success", async () => {
    const fake = createFakeDatabase(attachment());
    const attachmentRequest = vi.fn();
    mockApi(attachmentRequest);
    await renderReadyCenter(fake);
    fake.state.rows = [];

    fireEvent.click(screen.getByRole("button", { name: "上传并验证" }));

    await waitFor(() => {
      expect(screen.getByTestId("sync-inspector").textContent).toContain(
        "附件队列中没有待上传项。",
      );
    });
    expect(document.body.textContent).not.toContain("完成服务器哈希验证");
    expect(attachmentRequest).not.toHaveBeenCalled();
  });
});
