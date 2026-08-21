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
  request: vi.fn(),
  synchronize: vi.fn(),
  vaultSession: {} as Record<string, unknown>,
}));

vi.mock("@logion/offline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@logion/offline")>();
  return {
    ...actual,
    SyncClient: class SyncClient {
      synchronize(...args: unknown[]) {
        return mocks.synchronize(...args);
      }
    },
  };
});

vi.mock("@/lib/api/client", () => ({
  browserApiClient: {
    request: (...args: unknown[]) => mocks.request(...args),
  },
  LogionApiError: class LogionApiError extends Error {},
}));

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: {
      status: "authenticated",
      user: { id: "user-1" },
    },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vaultSession,
}));

import { TodayCenter } from "./today-center";

const workspace = {
  id: "workspace-1",
  name: "工作区",
};
const space = {
  id: "space-1",
  name: "空间",
  visibility: "private",
};
const device = {
  current: true,
  id: "device-1",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function localEntity(
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  syncStatus = "clean",
) {
  return {
    created_at: "2026-08-18T00:00:00.000Z",
    created_by: "user-1",
    deleted_at: null,
    device_id: "device-1",
    entity_id: entityId,
    entity_type: entityType,
    local_revision: 1,
    payload,
    server_version: 1,
    sync_status: syncStatus,
    updated_at: "2026-08-18T00:00:00.000Z",
    updated_by: "user-1",
    workspace_id: "workspace-1",
  };
}

function databaseWith(
  records: Record<string, unknown[]> = {},
  {
    conflictCount = 0,
    outbox = [],
  }: { conflictCount?: number; outbox?: Record<string, unknown>[] } = {},
) {
  return {
    conflicts: {
      where: () => ({
        equals: () => ({ count: () => Promise.resolve(conflictCount) }),
      }),
    },
    entities: {
      where: () => ({
        equals: ([, entityType]: [string, string]) => ({
          toArray: () => Promise.resolve(records[entityType] ?? []),
        }),
      }),
    },
    outbox: {
      where: () => ({
        equals: () => ({ toArray: () => Promise.resolve(outbox) }),
      }),
    },
    syncState: {
      get: () =>
        Promise.resolve({ bootstrap_state: "ready", device_id: "device-1" }),
    },
  };
}

function task({
  id = "task-1",
  spaceId = "space-1",
  status = "planned",
  title = "今日任务",
}: {
  id?: string;
  spaceId?: string;
  status?: string;
  title?: string;
} = {}) {
  return localEntity("task", id, {
    blocked_reason: null,
    description: "完成一项可验收产出",
    due_at: null,
    estimated_minutes: 30,
    goal_id: "goal-1",
    phase_id: null,
    planned_at: "2026-08-18T00:00:00.000Z",
    priority: 2,
    space_id: spaceId,
    status,
    title,
  });
}

function verification({
  id = "verification-1",
  spaceId = "space-1",
  taskId = "task-1",
}: {
  id?: string;
  spaceId?: string;
  taskId?: string;
} = {}) {
  return localEntity("verification", id, {
    decided_at: null,
    decided_by: null,
    evidence_id: "evidence-1",
    reviewer_notes: "",
    space_id: spaceId,
    task_id: taskId,
    verdict: "pending",
  });
}

function session({
  id = "session-1",
  spaceId = "space-1",
  status = "completed",
  taskId = "task-1",
}: {
  id?: string;
  spaceId?: string;
  status?: string;
  taskId?: string;
} = {}) {
  return localEntity("study_session", id, {
    ended_at: status === "active" ? null : "2026-08-18T01:00:00.000Z",
    manual_minutes: status === "active" ? null : 45,
    outcome: status === "active" ? null : "completed",
    reflection: "保留真实会话记录",
    space_id: spaceId,
    started_at: "2026-08-18T00:00:00.000Z",
    status,
    task_id: taskId,
  });
}

function evidence({
  id = "evidence-1",
  spaceId = "space-1",
  taskId = "task-1",
}: {
  id?: string;
  spaceId?: string;
  taskId?: string;
} = {}) {
  return localEntity("evidence", id, {
    captured_at: "2026-08-18T01:00:00.000Z",
    evidence_type: "text",
    external_url: null,
    note_id: null,
    resource_id: null,
    space_id: spaceId,
    summary: "可核对的成果",
    task_id: taskId,
  });
}

function reference(
  entityType: "note" | "resource",
  id: string,
  spaceId: string,
  syncStatus = "clean",
) {
  return localEntity(
    entityType,
    id,
    { space_id: spaceId, title: id },
    syncStatus,
  );
}

function resolveContextRequests({
  spaces = [space],
  workspaces = [workspace],
}: {
  spaces?: (typeof space)[];
  workspaces?: (typeof workspace)[];
} = {}) {
  mocks.request.mockImplementation((path: string) => {
    if (path === "/api/v1/workspaces") {
      return Promise.resolve({ workspaces });
    }
    if (path === "/api/v1/auth/devices") {
      return Promise.resolve({ devices: [device] });
    }
    if (path === "/api/v1/workspaces/workspace-1/spaces") {
      return Promise.resolve({ spaces });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
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

function useUnlockedVault(
  records: Record<string, unknown[]>,
  options?: { conflictCount?: number; outbox?: Record<string, unknown>[] },
) {
  Object.assign(mocks.vaultSession, {
    database: { current: databaseWith(records, options) },
    phase: "unlocked",
    revision: 1,
    unlock: vi.fn(),
    vault: { current: { get: vi.fn() } },
  });
}

beforeEach(() => {
  mocks.request.mockReset();
  mocks.synchronize.mockReset().mockResolvedValue(undefined);
  for (const key of Object.keys(mocks.vaultSession)) {
    delete mocks.vaultSession[key];
  }
});

afterEach(cleanup);

describe("TodayCenter workbench state", () => {
  it("keeps loading data out of the ready surface while preserving Vault access", () => {
    useLockedVault();
    mocks.request.mockImplementation(() => new Promise(() => {}));

    render(<TodayCenter />);

    expect(screen.getByText("正在准备真实数据")).toBeTruthy();
    expect(document.querySelector(".product-today-layout")).toBeNull();
    expect(screen.getByLabelText("本地口令")).toBeTruthy();
  });

  it("does not present zero metrics as ready while the Vault is locked", async () => {
    useLockedVault();
    resolveContextRequests();

    render(<TodayCenter />);

    expect(await screen.findByText("先解锁本地资料")).toBeTruthy();
    expect(document.querySelector(".product-today-layout")).toBeNull();
    expect(screen.getByLabelText("本地口令")).toBeTruthy();
  });

  it("keeps the recovery path when context loading fails and retries", async () => {
    useLockedVault();
    let workspaceAttempts = 0;
    mocks.request.mockImplementation((path: string) => {
      if (path === "/api/v1/workspaces") {
        workspaceAttempts += 1;
        return workspaceAttempts === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ workspaces: [workspace] });
      }
      if (path === "/api/v1/auth/devices") {
        return Promise.resolve({ devices: [device] });
      }
      if (path === "/api/v1/workspaces/workspace-1/spaces") {
        return Promise.resolve({ spaces: [space] });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<TodayCenter />);

    expect(await screen.findByText("工作台暂时无法读取")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    expect(await screen.findByText("先解锁本地资料")).toBeTruthy();
    expect(workspaceAttempts).toBe(2);
  });

  it("shows needs-context without inventing a Space or ready metrics", async () => {
    useLockedVault();
    resolveContextRequests({ workspaces: [] });

    render(<TodayCenter />);

    expect(await screen.findByText("还缺少工作台上下文")).toBeTruthy();
    expect(document.querySelector(".product-today-layout")).toBeNull();
    expect(screen.getByLabelText("本地口令")).toBeTruthy();
  });

  it("drops late Spaces and local reads after a fast Workspace switch", async () => {
    const firstRead = deferred<Record<string, unknown>[]>();
    const secondWorkspace = {
      ...workspace,
      id: "workspace-2",
      name: "工作区 B",
    };
    const secondSpace = {
      ...space,
      id: "space-2",
      name: "空间 B",
    };

    Object.assign(mocks.vaultSession, {
      database: {
        current: {
          conflicts: {
            where: () => ({
              equals: () => ({ count: () => Promise.resolve(0) }),
            }),
          },
          entities: {
            where: () => ({
              equals: ([selectedWorkspace, entityType]: [string, string]) => ({
                toArray: () =>
                  selectedWorkspace === "workspace-1" && entityType === "task"
                    ? firstRead.promise
                    : selectedWorkspace === "workspace-2" &&
                        entityType === "task"
                      ? Promise.resolve([
                          task({
                            id: "task-b",
                            spaceId: "space-2",
                            title: "工作区 B 任务",
                          }),
                        ])
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

    render(<TodayCenter />);
    const select = await screen.findByLabelText("工作区");
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-1/spaces",
        expect.any(Object),
      ),
    );

    fireEvent.change(select, { target: { value: "workspace-2" } });
    expect(await screen.findByRole("option", { name: /空间 B/ })).toBeTruthy();
    expect(
      await screen.findByRole("heading", { level: 2, name: "工作区 B 任务" }),
    ).toBeTruthy();

    await act(async () => {
      firstRead.resolve([task({ title: "过期工作区 A 任务" })]);
      await firstRead.promise;
    });

    expect((select as HTMLSelectElement).value).toBe("workspace-2");
    expect(
      screen.getByRole("heading", { level: 2, name: "工作区 B 任务" }),
    ).toBeTruthy();
    expect(screen.queryByText("过期工作区 A 任务")).toBeNull();
  });

  it("keeps a task without verification in the manual acceptance path", async () => {
    useUnlockedVault({ task: [task()] });
    resolveContextRequests();

    render(<TodayCenter />);

    await waitFor(() =>
      expect(
        document.querySelector(".product-today-layout")?.hasAttribute("hidden"),
      ).toBe(false),
    );
    expect(screen.getByText("ACCEPTANCE")).toBeTruthy();
    expect(screen.getByText("提交证据后由人工验收")).toBeTruthy();
    expect(screen.getByText("完成会话或提交证据都不会自动通过")).toBeTruthy();
  });

  it("keeps the original Next Action ordering while submitted work stays in Acceptance", async () => {
    useUnlockedVault({
      task: [
        task({ id: "task-a", title: "计划任务 A" }),
        task({ id: "task-b", status: "submitted", title: "待验收任务 B" }),
      ],
      verification: [verification({ taskId: "task-b" })],
    });
    resolveContextRequests();

    render(<TodayCenter />);

    await waitFor(() =>
      expect(
        document.querySelector(".product-today-layout")?.hasAttribute("hidden"),
      ).toBe(false),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "计划任务 A" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("heading", { level: 3, name: "待验收任务 B" }),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "▶ 开始任务" })).toBeTruthy();
    expect(screen.getByText("完成会话或提交证据都不会自动通过")).toBeTruthy();
  });

  it("does not start a Session for submitted work with a pending verification", async () => {
    useUnlockedVault({
      task: [task({ status: "submitted", title: "待验收任务" })],
      verification: [verification()],
    });
    resolveContextRequests();

    render(<TodayCenter />);

    await waitFor(() =>
      expect(
        document.querySelector(".product-today-layout")?.hasAttribute("hidden"),
      ).toBe(false),
    );
    expect(screen.queryByRole("button", { name: "▶ 开始任务" })).toBeNull();
    expect(screen.queryByRole("button", { name: "开始会话" })).toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "证据与人工验收" }),
    ).toBeTruthy();
  });

  it("keeps an active Session task ahead of the actionable queue", async () => {
    useUnlockedVault({
      study_session: [session({ status: "active", taskId: "task-active" })],
      task: [
        task({ id: "task-planned", title: "更高优先级计划任务" }),
        task({
          id: "task-active",
          status: "in_progress",
          title: "当前会话任务",
        }),
      ],
    });
    resolveContextRequests();

    render(<TodayCenter />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "当前会话任务" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "继续本次专注" })).toBeTruthy();
  });

  it("uses current-Space action data for empty instead of Workspace-wide references", async () => {
    useUnlockedVault({
      note: [reference("note", "note-current", "space-1")],
      resource: [reference("resource", "resource-current", "space-1")],
      task: [task({ id: "task-other", spaceId: "space-2" })],
    });
    resolveContextRequests();

    render(<TodayCenter />);

    expect(await screen.findByText("今天还没有行动记录")).toBeTruthy();
    expect(document.querySelector(".product-today-layout")).toBeTruthy();
  });

  it("surfaces dirty current-Space references as offline-stale, not ready", async () => {
    useUnlockedVault({
      note: [reference("note", "note-dirty", "space-1", "pending")],
    });
    resolveContextRequests();

    render(<TodayCenter />);

    expect(await screen.findByText("正在使用本机数据")).toBeTruthy();
    expect(document.querySelector(".product-today-layout")).toBeTruthy();
  });

  it("keeps Workspace-level conflicts out of the current Space stale derivation", async () => {
    useUnlockedVault({ task: [task()] }, { conflictCount: 2 });
    resolveContextRequests();

    render(<TodayCenter />);

    expect(await screen.findByText(/Workspace 级告警/)).toBeTruthy();
    expect(screen.queryByText("正在使用本机数据")).toBeNull();
    expect(document.querySelector(".product-today-layout")).toBeTruthy();
  });

  it("preserves Outbox, Task, Session, Evidence and Verification flows", async () => {
    useUnlockedVault(
      {
        evidence: [evidence()],
        study_session: [session()],
        task: [task({ status: "submitted" })],
        verification: [verification()],
      },
      { outbox: [{ outbox_state: "pending" }] },
    );
    resolveContextRequests();

    render(<TodayCenter />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "证据与人工验收" }),
    ).toBeTruthy();
    expect(screen.getByText("可核对的成果")).toBeTruthy();
    expect(screen.getByText("45m")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "专注会话" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "立即同步" }));

    await waitFor(() => expect(mocks.synchronize).toHaveBeenCalled());
    expect(
      await screen.findByText(/仍有 1 项本地修改等待网络恢复后同步/),
    ).toBeTruthy();
  });
});
