/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkbenchQueryClient } from "@/platform/workbench/api";
import { AISettings } from "./ai-settings";
import { AuditSettings } from "./audit-settings";
import { DataSettings } from "./data-settings";
import { SecuritySettings } from "./security-settings";
import { LogionApiError } from "@/lib/api/client";
const mocks = vi.hoisted(() => ({ request: vi.fn(), role: "owner" }));
vi.mock("@/platform/workbench/provider", () => ({
  useWorkbench: () => ({
    context: { workspace_id: "workspace", space_id: "space" },
    workspaces: [{ id: "workspace", name: "合成工作区", role: mocks.role }],
  }),
}));
vi.mock("@/platform/workbench/api", async () => ({
  ...(await vi.importActual("@/platform/workbench/api")),
  workbenchRequest: mocks.request,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "owner";
});
it("does not request provider or routing data for a read-only member", async () => {
  mocks.role = "viewer";
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <AISettings />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "只有工作区所有者或管理员",
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "添加服务商" })).toBeNull();
});
it("appends audit pages and clears the personal projection when switching scope", async () => {
  const event = (id: string, event_type: string) => ({
    id,
    event_type,
    result: "success",
    actor_id: null,
    target_type: "synthetic",
    target_id: null,
    occurred_at: "2026-09-01T00:00:00Z",
  });
  mocks.request.mockImplementation(
    async (path: string, options: { query: Record<string, string> }) => {
      if (path.endsWith("/audit-events"))
        return {
          events: [event("workspace-event", "ai.route_created")],
          next_cursor: null,
        };
      if (options.query.cursor)
        return {
          events: [event("second", "identity.logout")],
          next_cursor: null,
        };
      return {
        events: [event("first", "identity.login_succeeded")],
        next_cursor: "next-synthetic-page",
      };
    },
  );
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <AuditSettings />
    </QueryClientProvider>,
  );
  await screen.findByText("操作代码：identity.login_succeeded");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "加载更多记录" }));
  await screen.findByText("操作代码：identity.logout");
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(mocks.request.mock.calls[1]![1].query.cursor).toBe(
    "next-synthetic-page",
  );
  fireEvent.change(screen.getByRole("combobox", { name: "审计范围" }), {
    target: { value: "workspace" },
  });
  await screen.findByText("操作代码：ai.route_created");
  expect(screen.queryByText("操作代码：identity.login_succeeded")).toBeNull();
  expect(screen.queryByText("操作代码：identity.logout")).toBeNull();
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(3));
});

it("keeps device revocation confirmation and failure visible without reporting success", async () => {
  const device = {
    id: "device",
    name: "合成设备",
    current: false,
    platform: "web",
    first_seen_at: "2026-09-01T00:00:00Z",
    last_seen_at: "2026-09-01T00:00:00Z",
    revoked_at: null,
  };
  mocks.request.mockImplementation(
    async (_path: string, options: { method?: string }) => {
      if (options.method === "DELETE")
        throw new LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          status: 403,
          message: "Recent authentication required",
        });
      return { devices: [device] };
    },
  );
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <SecuritySettings />
    </QueryClientProvider>,
  );
  await screen.findByText("合成设备");
  fireEvent.click(screen.getByRole("button", { name: "撤销设备" }));
  expect(
    mocks.request.mock.calls.filter((call) => call[1]?.method === "DELETE"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "确认操作" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("请重新登录");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getAllByRole("listitem", { hidden: true })).toHaveLength(1);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("requires explicit export confirmation and retains authentication failures in the dialog", async () => {
  mocks.request.mockImplementation(
    async (_path: string, options: { method?: string }) => {
      if (options.method === "POST")
        throw new LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          status: 403,
          message: "Recent authentication required",
        });
      return { exports: [] };
    },
  );
  render(
    <QueryClientProvider client={createWorkbenchQueryClient()}>
      <DataSettings />
    </QueryClientProvider>,
  );
  await screen.findByText("还没有导出记录。");
  fireEvent.click(screen.getByRole("button", { name: "创建导出" }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "确认创建",
    }).disabled,
  ).toBe(true);
  expect(
    mocks.request.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("请重新登录");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
