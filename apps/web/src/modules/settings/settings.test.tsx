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
