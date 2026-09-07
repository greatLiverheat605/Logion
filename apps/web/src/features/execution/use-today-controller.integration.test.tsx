/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  ProtectedOfflineRepository,
  SyncClient,
  type JsonObject,
  type LocalEntity,
  type OutboxEntry,
} from "@logion/offline";
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Today 会话同步投影", () => {
  it.each(["completed", "abandoned"] as const)(
    "结束为 %s 后保留会话及非空 outcome，并可重新加载",
    async (outcome) => {
      let storedPayload: JsonObject = {
        ended_at: null,
        manual_minutes: null,
        outcome: "completed",
        reflection: "",
        space_id: "space-1",
        started_at: "2026-09-07T00:00:00.000Z",
        status: "active",
        task_id: "task-1",
      };
      const sessionRow: LocalEntity = {
        ...task("workspace-1", "space-1", "session-1"),
        entity_type: "study_session",
        payload: { encrypted_payload_ref: "session-record" },
        payload_hash: `sha256:${"a".repeat(64)}`,
        sync_status: "clean",
      };
      const vaultGet = vi.fn(async () => storedPayload);
      Object.assign(mocks.vaultSession, {
        database: {
          current: {
            conflicts: {
              where: () => ({ equals: () => ({ count: async () => 0 }) }),
            },
            entities: {
              where: () => ({
                equals: ([, entityType]: [string, string]) => ({
                  toArray: async () =>
                    entityType === "study_session"
                      ? [sessionRow]
                      : entityType === "task"
                        ? [task("workspace-1", "space-1", "task-1")]
                        : [],
                }),
              }),
            },
            outbox: {
              where: () => ({ equals: () => ({ toArray: async () => [] }) }),
            },
            syncState: {
              get: async () => ({
                bootstrap_state: "ready",
                device_id: "device-1",
              }),
            },
          },
        },
        phase: "unlocked",
        revision: 1,
        unlock: vi.fn(),
        vault: { current: { get: vaultGet } },
      });
      mocks.request.mockImplementation((path: string) => {
        if (path === "/api/v1/workspaces")
          return Promise.resolve({
            workspaces: [{ id: "workspace-1", name: "测试", role: "owner" }],
          });
        if (path === "/api/v1/auth/devices")
          return Promise.resolve({
            devices: [{ current: true, id: "device-1" }],
          });
        if (path.endsWith("/spaces"))
          return Promise.resolve({
            spaces: [{ id: "space-1", name: "测试", visibility: "private" }],
          });
        if (path.endsWith("/members")) return Promise.resolve({ members: [] });
        throw new Error(`Unexpected request: ${path}`);
      });
      const commit = vi
        .spyOn(ProtectedOfflineRepository.prototype, "commitMutation")
        .mockImplementation(async (input) => {
          storedPayload = input.payload;
          return {
            kind: "committed",
            entity: sessionRow,
            operation: {} as OutboxEntry,
          };
        });
      const synchronize = vi
        .spyOn(SyncClient.prototype, "synchronize")
        .mockImplementation(async () => {
          // 真实 Pull 只持久化 status，不返回结束命令的 outcome。
          const { outcome: commandOutcome, ...canonical } = storedPayload;
          expect(commandOutcome).toBe(outcome);
          storedPayload = canonical;
          return { pushed: 1, pulled: 1, has_more: false, control: null };
        });
      const { result, unmount } = renderHook(() => useTodayController());
      await waitFor(() => {
        expect(result.current.viewModel.activeSession?.entity.entity_id).toBe(
          "session-1",
        );
      });
      expect(
        result.current.viewModel.activeSession?.payload.outcome,
      ).toBeNull();
      await act(async () => {
        expect(
          await result.current.commands.finishSession({
            manualMinutes: 1,
            outcome,
            reflection: "结束后的反思",
          }),
        ).toBe(true);
      });
      expect(commit).toHaveBeenCalledOnce();
      expect(synchronize).toHaveBeenCalledOnce();
      expect(storedPayload).not.toHaveProperty("outcome");
      expect(result.current.viewModel.activeSession).toBeUndefined();
      expect(result.current.viewModel.visibleSessions).toHaveLength(1);
      expect(
        result.current.viewModel.visibleSessions[0]?.payload,
      ).toMatchObject({
        status: outcome,
        outcome,
        manual_minutes: 1,
        reflection: "结束后的反思",
      });
      unmount();
      storedPayload = {
        ...storedPayload,
        outcome: outcome === "completed" ? "abandoned" : "completed",
      };
      const reloaded = renderHook(() => useTodayController());
      await waitFor(() => {
        expect(
          reloaded.result.current.viewModel.visibleSessions[0]?.payload,
        ).toMatchObject({
          status: outcome,
          outcome,
        });
      });
      expect(storedPayload.outcome).not.toBe(outcome);
    },
  );
});

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
      result.current.commands.reportDeletion(
        "删除尚未完成：SYNC_DELETE_BLOCKED_BY_REFERENCE",
      );
      firstRead.resolve([task("workspace-1", "space-1", "stale-task-a")]);
      await firstRead.promise;
    });

    expect(result.current.context.workspaceId).toBe("workspace-2");
    expect(result.current.viewModel.queue[0]?.entity.entity_id).toBe("task-b");
    expect(result.current.context.status).toBe(
      "删除尚未完成：SYNC_DELETE_BLOCKED_BY_REFERENCE",
    );
  });
});
