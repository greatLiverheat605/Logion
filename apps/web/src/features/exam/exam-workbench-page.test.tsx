/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeInspector: vi.fn(),
  openInspector: vi.fn(),
  request: vi.fn(),
  vaultSession: {} as Record<string, unknown>,
}));

vi.mock("@/lib/api/client", () => ({
  browserApiClient: {
    request: (...args: unknown[]) => mocks.request(...args),
  },
  LogionApiError: class LogionApiError extends Error {
    readonly code: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly status: number;

    constructor(input: {
      code: string;
      message: string;
      requestId?: string;
      retryable?: boolean;
      status: number;
    }) {
      super(input.message);
      this.code = input.code;
      this.requestId = input.requestId ?? "unavailable";
      this.retryable = input.retryable ?? false;
      this.status = input.status;
    }
  },
}));

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));

vi.mock("@/features/desk/command-feedback-context", () => ({
  useInspector: () => ({
    closeInspector: mocks.closeInspector,
    openInspector: mocks.openInspector,
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vaultSession,
}));

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({ activePersona: { id: "exam" } }),
}));

import { LogionApiError } from "@/lib/api/client";

import { ExamCenter } from "./exam-center";

const workspace = {
  id: "workspace-1",
  name: "考试工作区",
  role: "editor",
};
const space = {
  id: "space-1",
  name: "备考空间",
  visibility: "private",
  workspace_id: "workspace-1",
};
const device = { current: true, id: "device-1" };

function entity(
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  syncStatus = "clean",
) {
  return {
    created_at: "2026-08-19T00:00:00.000Z",
    created_by: "user-1",
    deleted_at: null,
    device_id: "device-1",
    entity_id: entityId,
    entity_type: entityType,
    local_revision: 1,
    payload,
    server_version: 1,
    sync_status: syncStatus,
    updated_at: "2026-08-19T00:00:00.000Z",
    updated_by: "user-1",
    workspace_id: "workspace-1",
  };
}

function exam(syncStatus = "clean") {
  return entity(
    "exam",
    "exam-1",
    {
      date_status: "scheduled",
      exam_at: "2026-10-01T09:00:00.000Z",
      score_scale_max: 100,
      space_id: "space-1",
      status: "active",
      target_score: 85,
      timezone: "Asia/Shanghai",
      title: "真实考试",
    },
    syncStatus,
  );
}

function databaseWith(records: Record<string, unknown[]> = {}) {
  return {
    entities: {
      where: () => ({
        equals: ([, entityType]: [string, string]) => ({
          toArray: () => Promise.resolve(records[entityType] ?? []),
        }),
      }),
    },
  };
}

function useLockedVault() {
  Object.assign(mocks.vaultSession, {
    database: { current: null },
    phase: "locked",
    revision: 0,
    unlock: vi.fn(),
    vault: { current: null },
  });
}

function useUnlockedVault(records: Record<string, unknown[]> = {}) {
  Object.assign(mocks.vaultSession, {
    database: { current: databaseWith(records) },
    phase: "unlocked",
    revision: 1,
    unlock: vi.fn(),
    vault: { current: { get: vi.fn() } },
  });
}

function resolveContext() {
  mocks.request.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces") {
      return Promise.resolve({ workspaces: [workspace] });
    }
    if (path === "/api/v1/auth/devices") {
      return Promise.resolve({ devices: [device] });
    }
    if (path === "/api/v1/workspaces/workspace-1/spaces") {
      return Promise.resolve({ spaces: [space] });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function apiError(status: number, code: string) {
  return new LogionApiError({
    code,
    message: "sensitive server detail",
    requestId: `req-${status}`,
    status,
  });
}

beforeEach(() => {
  mocks.closeInspector.mockReset();
  mocks.openInspector.mockReset();
  mocks.request.mockReset();
  for (const key of Object.keys(mocks.vaultSession)) {
    delete mocks.vaultSession[key];
  }
});

afterEach(cleanup);

describe("ExamCenter workbench integration", () => {
  it("keeps the exam workflow out of loading", () => {
    useLockedVault();
    mocks.request.mockImplementation(() => new Promise(() => {}));

    render(<ExamCenter />);

    expect(screen.getByText("正在准备真实数据")).toBeTruthy();
    expect(screen.queryByText("建立你的第一个备考目标")).toBeNull();
  });

  it("shows locked and disabled states without exposing zero-value metrics", async () => {
    useLockedVault();
    resolveContext();

    render(<ExamCenter />);

    expect(await screen.findByText("先解锁本地资料")).toBeTruthy();
    expect(screen.queryByText("建立你的第一个备考目标")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders the explicit empty state after protected reads settle", async () => {
    useUnlockedVault();
    resolveContext();

    render(<ExamCenter />);

    expect(await screen.findByText("当前 Space 还没有备考项目")).toBeTruthy();
    expect(screen.getByText("建立你的第一个备考目标")).toBeTruthy();
  });

  it("renders ready records and opens the existing Inspector", async () => {
    useUnlockedVault({ exam: [exam()] });
    resolveContext();

    render(<ExamCenter />);

    fireEvent.click(
      await screen.findByRole("button", { name: "查看考试详情" }),
    );
    await waitFor(() => expect(mocks.openInspector).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("当前 Space 还没有备考项目")).toBeNull();
  });

  it("labels dirty protected records as stale instead of ready", async () => {
    useUnlockedVault({ exam: [exam("pending")] });
    resolveContext();

    render(<ExamCenter />);

    expect(await screen.findByText("正在使用本机数据")).toBeTruthy();
    expect(screen.getAllByText("真实考试").length).toBeGreaterThan(0);
  });

  it("keeps unavailable commands disabled without inventing success", async () => {
    useLockedVault();
    resolveContext();

    render(<ExamCenter />);

    const synchronize = await screen.findByRole("button", {
      name: "立即同步",
    });
    const requestCount = mocks.request.mock.calls.length;
    fireEvent.click(synchronize);
    expect((synchronize as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(requestCount);
    expect(screen.queryByText("备考数据已同步。")).toBeNull();
  });

  it.each([
    [
      "offline",
      apiError(0, "WEB_NETWORK_UNAVAILABLE"),
      "当前离线；只有已经写入 Outbox 的考试数据才会在恢复网络后同步。",
    ],
    [
      "permission denied",
      apiError(403, "FORBIDDEN"),
      "当前账号没有权限完成此操作（请求编号：req-403）。",
    ],
    [
      "409",
      apiError(409, "VERSION_CONFLICT"),
      "考试数据已发生变化；请重新读取后再试（请求编号：req-409）。",
    ],
    ["error", new Error("boom"), "操作未完成；请重试。"],
  ])("renders %s as distinct page feedback", async (_, error, expected) => {
    useLockedVault();
    mocks.request.mockRejectedValue(error);

    render(<ExamCenter />);

    expect(await screen.findByText("工作台暂时无法读取")).toBeTruthy();
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText("sensitive server detail")).toBeNull();
  });
});
