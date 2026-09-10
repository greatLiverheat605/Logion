/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { integrationCapabilityService } from "@/features/integrations/integration-capability-service";
import type {
  DataExport,
  Workspace,
} from "@/features/integrations/integration-capability-model";
import { useDataController } from "./use-data-controller";

vi.mock("@/features/integrations/integration-capability-service", () => ({
  integrationCapabilityService: {
    listWorkspaces: vi.fn(),
    loadPortability: vi.fn(),
    createExport: vi.fn(),
  },
}));

const service = vi.mocked(integrationCapabilityService);
const workspace: Workspace = {
  id: "workspace-1",
  name: "测试工作区",
  role: "owner",
  status: "active",
  membership_status: "active",
  version: 1,
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};
const item: DataExport = {
  id: "export-1",
  workspace_id: workspace.id,
  status: "queued",
  version: 1,
  artifact_bytes: null,
  artifact_sha256: null,
  completed_at: null,
  error_code: null,
  expires_at: "2026-09-07T00:00:00Z",
  schema_version: "logion-export-v1",
  created_at: "2026-09-06T00:00:00Z",
};
function data(
  status: DataExport["status"] = "queued",
  workspaceId = workspace.id,
) {
  return {
    exports: [{ ...item, status, workspace_id: workspaceId }],
    imports: [],
    privateSpaces: [],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function mount() {
  const hook = renderHook(() => useDataController());
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.loading).toBe(false);
  return hook;
}
async function tick(milliseconds = 5000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  service.listWorkspaces.mockResolvedValue([
    workspace,
    { ...workspace, id: "workspace-2" },
  ]);
  service.loadPortability.mockResolvedValue(data());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("conditional export polling", () => {
  it.each(["queued", "running"] as const)(
    "polls %s exports after five seconds",
    async (status) => {
      service.loadPortability.mockResolvedValue(data(status));
      const { result } = await mount();
      expect(vi.getTimerCount()).toBe(1);
      await tick(4999);
      expect(service.loadPortability).toHaveBeenCalledTimes(1);
      await tick(1);
      expect(service.loadPortability).toHaveBeenCalledTimes(2);
      expect(result.current.context.exports[0]?.status).toBe(status);
    },
  );

  it.each(["succeeded", "failed", "expired", "cancelled"] as const)(
    "stops after %s",
    async (status) => {
      await mount();
      service.loadPortability.mockResolvedValue(data(status));
      await tick();
      expect(vi.getTimerCount()).toBe(0);
      await tick(15000);
      expect(service.loadPortability).toHaveBeenCalledTimes(2);
    },
  );

  it("does not poll an empty list", async () => {
    service.loadPortability.mockResolvedValue({
      exports: [],
      imports: [],
      privateSpaces: [],
    });
    await mount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans the timer and visibility listener on unmount", async () => {
    const { unmount } = await mount();
    unmount();
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    await tick();
    expect(service.loadPortability).toHaveBeenCalledTimes(1);
  });

  it("pauses while hidden and resumes when visible", async () => {
    await mount();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick(15000);
    expect(service.loadPortability).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick();
    expect(service.loadPortability).toHaveBeenCalledTimes(2);
  });

  it("pauses offline and resumes after reconnecting", async () => {
    await mount();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(vi.getTimerCount()).toBe(0);
    await tick();
    expect(service.loadPortability).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    await tick();
    expect(service.loadPortability).toHaveBeenCalledTimes(2);
  });

  it("does not overlap slow polling requests", async () => {
    const slow = deferred<ReturnType<typeof data>>();
    const { result } = await mount();
    service.loadPortability.mockReturnValue(slow.promise);
    await tick();
    await tick(15000);
    expect(service.loadPortability).toHaveBeenCalledTimes(2);
    expect(result.current.context.exports[0]?.status).toBe("queued");
    await act(async () => slow.resolve(data("succeeded")));
    expect(result.current.context.exports[0]?.status).toBe("succeeded");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps polling failures visible and stops automatic retries", async () => {
    const { result } = await mount();
    service.loadPortability.mockRejectedValue(new Error("network unavailable"));
    await tick();
    expect(result.current.context.dataState).toBe("error");
    expect(result.current.context.status).toContain("操作未完成");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a stale response after switching workspace", async () => {
    const slow = deferred<ReturnType<typeof data>>();
    const { result } = await mount();
    service.loadPortability.mockReturnValueOnce(slow.promise);
    await tick();
    service.loadPortability.mockResolvedValue(data("failed", "workspace-2"));
    await act(async () =>
      result.current.commands.selectWorkspace("workspace-2"),
    );
    await act(async () => slow.resolve(data("succeeded")));
    expect(result.current.context.selectedWorkspace?.id).toBe("workspace-2");
    expect(result.current.context.exports[0]).toMatchObject({
      status: "failed",
      workspace_id: "workspace-2",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let a late poll hide a mutation failure", async () => {
    const slow = deferred<ReturnType<typeof data>>();
    const { result } = await mount();
    service.loadPortability.mockReturnValueOnce(slow.promise);
    await tick();
    service.createExport.mockRejectedValue(new Error("create failed"));
    await act(async () => {
      expect(await result.current.commands.createExport("EXPORT")).toBe(false);
    });
    await act(async () => slow.resolve(data("succeeded")));
    expect(result.current.context.dataState).toBe("error");
    expect(result.current.context.status).toContain("操作未完成");
    expect(result.current.context.exports[0]?.status).toBe("queued");
    expect(vi.getTimerCount()).toBe(0);
  });
});
