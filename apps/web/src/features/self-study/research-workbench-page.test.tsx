/** @vitest-environment jsdom */

import {
  act,
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
  usePersona: () => ({ activePersona: { id: "research" } }),
}));

import { LogionApiError } from "@/lib/api/client";

import { ResearchCenter } from "./self-study-center";

const workspace = {
  id: "workspace-1",
  name: "研究工作区",
  role: "editor",
};
const space = {
  id: "space-1",
  name: "研究空间",
  visibility: "private",
  workspace_id: "workspace-1",
};
const device = { current: true, id: "device-1" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

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

function paper(syncStatus = "clean") {
  return entity(
    "paper_record",
    "paper-1",
    {
      citation_key: "R-001",
      source_url: "https://example.com/paper",
      space_id: "space-1",
      title: "可信研究论文",
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

describe("ResearchCenter workbench integration", () => {
  it("keeps the research surface out of loading", () => {
    useLockedVault();
    mocks.request.mockImplementation(() => new Promise(() => {}));

    render(<ResearchCenter />);

    expect(screen.getByText("正在准备真实数据")).toBeTruthy();
    expect(screen.queryByLabelText("研究证据概览")).toBeNull();
  });

  it("shows locked and disabled states without exposing zero-value research", async () => {
    useLockedVault();
    resolveContext();

    render(<ResearchCenter />);

    expect(await screen.findByText("先解锁本地资料")).toBeTruthy();
    expect(screen.queryByLabelText("研究证据概览")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "立即同步" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders the explicit empty state after protected reads settle", async () => {
    useUnlockedVault();
    resolveContext();

    render(<ResearchCenter />);

    expect(await screen.findByText("当前 Space 还没有研究记录")).toBeTruthy();
    expect(screen.getByLabelText("研究证据概览")).toBeTruthy();
  });

  it("renders ready records and opens the existing Inspector", async () => {
    useUnlockedVault({ paper_record: [paper()] });
    resolveContext();

    render(<ResearchCenter />);

    fireEvent.click(
      await screen.findByRole("button", { name: /可信研究论文/ }),
    );
    await waitFor(() => expect(mocks.openInspector).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("当前 Space 还没有研究记录")).toBeNull();
  });

  it("labels dirty protected records as stale instead of ready", async () => {
    useUnlockedVault({ paper_record: [paper("pending")] });
    resolveContext();

    render(<ResearchCenter />);

    expect(await screen.findByText("正在使用本机数据")).toBeTruthy();
    expect(screen.getAllByText("可信研究论文").length).toBeGreaterThan(0);
  });

  it("keeps unavailable commands disabled without inventing success", async () => {
    useLockedVault();
    resolveContext();

    render(<ResearchCenter />);

    const synchronize = await screen.findByRole("button", {
      name: "立即同步",
    });
    const requestCount = mocks.request.mock.calls.length;
    fireEvent.click(synchronize);
    expect((synchronize as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.request).toHaveBeenCalledTimes(requestCount);
    expect(screen.queryByText("自主学习资料已同步。")).toBeNull();
  });

  it.each([
    [
      "offline",
      apiError(0, "WEB_NETWORK_UNAVAILABLE"),
      "当前离线；只有已经写入 Outbox 的内容才会在恢复网络后同步。",
    ],
    [
      "permission denied",
      apiError(403, "FORBIDDEN"),
      "当前账号没有权限完成此操作（请求编号：req-403）。",
    ],
    [
      "409",
      apiError(409, "VERSION_CONFLICT"),
      "数据已发生变化；请重新读取后再试（请求编号：req-409）。",
    ],
    ["error", new Error("boom"), "操作未完成；请重试。"],
  ])("renders %s as distinct page feedback", async (_, error, expected) => {
    useLockedVault();
    mocks.request.mockRejectedValue(error);

    render(<ResearchCenter />);

    expect(await screen.findByText("工作台暂时无法读取")).toBeTruthy();
    expect(screen.getByText(expected)).toBeTruthy();
    expect(screen.queryByText("sensitive server detail")).toBeNull();
  });

  it("drops a late Space response after a fast Workspace switch", async () => {
    useLockedVault();
    const firstSpaces = deferred<{ spaces: (typeof space)[] }>();
    const secondWorkspace = {
      ...workspace,
      id: "workspace-2",
      name: "工作区 B",
    };
    const secondSpace = {
      ...space,
      id: "space-2",
      name: "空间 B",
      workspace_id: "workspace-2",
    };
    mocks.request.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({ workspaces: [workspace, secondWorkspace] });
      }
      if (path === "/api/v1/auth/devices") {
        return Promise.resolve({ devices: [device] });
      }
      if (path === "/api/v1/workspaces/workspace-1/spaces") {
        return firstSpaces.promise;
      }
      if (path === "/api/v1/workspaces/workspace-2/spaces") {
        return Promise.resolve({ spaces: [secondSpace] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<ResearchCenter />);
    const select = await screen.findByLabelText("工作区");
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-1/spaces",
        expect.any(Object),
      ),
    );
    fireEvent.change(select, { target: { value: "workspace-2" } });
    expect(await screen.findByRole("option", { name: "空间 B" })).toBeTruthy();

    await act(async () => {
      firstSpaces.resolve({ spaces: [{ ...space, name: "过期空间 A" }] });
      await firstSpaces.promise;
    });

    expect((select as HTMLSelectElement).value).toBe("workspace-2");
    expect(screen.queryByRole("option", { name: "过期空间 A" })).toBeNull();
  });

  it("drops a late local read after a fast Workspace switch", async () => {
    const firstRead = deferred<unknown[]>();
    const secondWorkspace = {
      ...workspace,
      id: "workspace-2",
      name: "工作区 B",
    };
    const secondSpace = {
      ...space,
      id: "space-2",
      name: "空间 B",
      workspace_id: "workspace-2",
    };
    Object.assign(mocks.vaultSession, {
      database: {
        current: {
          entities: {
            where: () => ({
              equals: ([workspaceId, entityType]: [string, string]) => ({
                toArray: () =>
                  workspaceId === "workspace-1" && entityType === "paper_record"
                    ? firstRead.promise
                    : Promise.resolve([]),
              }),
            }),
          },
        },
      },
      phase: "unlocked",
      revision: 1,
      unlock: vi.fn(),
      vault: { current: { get: vi.fn() } },
    });
    mocks.request.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        return Promise.resolve({ workspaces: [workspace, secondWorkspace] });
      }
      if (path === "/api/v1/auth/devices") {
        return Promise.resolve({ devices: [device] });
      }
      if (path === "/api/v1/workspaces/workspace-1/spaces") {
        return Promise.resolve({ spaces: [space] });
      }
      if (path === "/api/v1/workspaces/workspace-2/spaces") {
        return Promise.resolve({ spaces: [secondSpace] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<ResearchCenter />);
    const select = await screen.findByLabelText("工作区");
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-1/spaces",
        expect.any(Object),
      ),
    );
    fireEvent.change(select, { target: { value: "workspace-2" } });
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-2/spaces",
        expect.any(Object),
      ),
    );
    expect(await screen.findByText("当前 Space 还没有研究记录")).toBeTruthy();

    await act(async () => {
      firstRead.resolve([paper()]);
      await firstRead.promise;
    });

    expect(screen.queryByText("可信研究论文")).toBeNull();
  });
});
