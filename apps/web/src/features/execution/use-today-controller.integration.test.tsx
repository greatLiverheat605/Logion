/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  vaultSession: {} as Record<string, unknown>,
}));

vi.mock("@/features/auth/session-provider", () => ({
  useSession: () => ({
    state: { status: "authenticated", user: { id: "user-1" } },
  }),
}));

vi.mock("@/features/offline/vault-session-provider", () => ({
  useVaultSession: () => mocks.vaultSession,
}));

vi.mock("@/features/personas/persona-context", () => ({
  usePersona: () => ({ activePersona: null }),
}));

vi.mock("@/lib/api/client", () => ({
  browserApiClient: {
    request: (...args: unknown[]) => mocks.request(...args),
  },
  LogionApiError: class LogionApiError extends Error {
    status = 500;
  },
}));

import { useTodayController } from "./use-today-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function task(workspaceId: string, spaceId: string, id: string) {
  return {
    created_at: "2026-08-18T00:00:00.000Z",
    created_by: "user-1",
    deleted_at: null,
    device_id: "device-1",
    entity_id: id,
    entity_type: "task",
    local_revision: 1,
    payload: {
      blocked_reason: null,
      description: "",
      due_at: null,
      estimated_minutes: 30,
      goal_id: "goal-1",
      phase_id: null,
      planned_at: "2026-08-18T00:00:00.000Z",
      priority: 2,
      space_id: spaceId,
      status: "planned",
      title: id,
    },
    server_version: 1,
    sync_status: "clean",
    updated_at: "2026-08-18T00:00:00.000Z",
    updated_by: "user-1",
    workspace_id: workspaceId,
  };
}

beforeEach(() => {
  mocks.request.mockReset();
  for (const key of Object.keys(mocks.vaultSession)) {
    delete mocks.vaultSession[key];
  }
});

afterEach(cleanup);

describe("Today controller Workspace isolation", () => {
  it("drops a late local read after switching Workspace", async () => {
    const firstRead = deferred<Record<string, unknown>[]>();
    const firstReadStarted = deferred<void>();
    const workspaceA = { id: "workspace-1", name: "工作区 A", role: "owner" };
    const workspaceB = { id: "workspace-2", name: "工作区 B", role: "owner" };
    const spaceA = { id: "space-1", name: "空间 A", visibility: "private" };
    const spaceB = { id: "space-2", name: "空间 B", visibility: "private" };

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
              equals: ([workspaceId, entityType]: [string, string]) => ({
                toArray: () => {
                  if (workspaceId === "workspace-1" && entityType === "task") {
                    firstReadStarted.resolve();
                    return firstRead.promise;
                  }
                  if (workspaceId === "workspace-2" && entityType === "task") {
                    return Promise.resolve([
                      task("workspace-2", "space-2", "task-b"),
                    ]);
                  }
                  return Promise.resolve([]);
                },
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
        return Promise.resolve({ workspaces: [workspaceA, workspaceB] });
      }
      if (path === "/api/v1/auth/devices") {
        return Promise.resolve({
          devices: [{ current: true, id: "device-1" }],
        });
      }
      if (path === "/api/v1/workspaces/workspace-1/spaces") {
        return Promise.resolve({ spaces: [spaceA] });
      }
      if (path === "/api/v1/workspaces/workspace-2/spaces") {
        return Promise.resolve({ spaces: [spaceB] });
      }
      if (path.endsWith("/members")) return Promise.resolve({ members: [] });
      throw new Error(`Unexpected request: ${path}`);
    });

    const { result } = renderHook(() => useTodayController());

    await firstReadStarted.promise;
    act(() => result.current.commands.setWorkspaceId("workspace-2"));

    await waitFor(() => {
      expect(result.current.context.workspaceId).toBe("workspace-2");
      expect(result.current.context.spaceId).toBe("space-2");
      expect(result.current.viewModel.queue[0]?.entity.entity_id).toBe(
        "task-b",
      );
    });

    await act(async () => {
      firstRead.resolve([task("workspace-1", "space-1", "stale-task-a")]);
      await firstRead.promise;
    });

    expect(result.current.context.workspaceId).toBe("workspace-2");
    expect(result.current.viewModel.queue[0]?.entity.entity_id).toBe("task-b");
  });
});
