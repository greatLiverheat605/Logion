/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
  return { ...actual, browserApiClient: { request } };
});

import { ProviderCenter } from "./provider-center";
import { AIRunCenter } from "./run-center";
import { AIWorkbenchPage } from "./ai-workbench-page";

afterEach(cleanup);

const workspace = {
  created_at: "2026-08-01T00:00:00Z",
  id: "workspace-1",
  membership_status: "active",
  name: "个人工作区",
  role: "owner",
  status: "active",
  updated_at: "2026-08-01T00:00:00Z",
  version: 1,
};

const draft = {
  created_at: "2026-08-01T00:00:00Z",
  decision_note: null,
  decided_at: null,
  edited_output: null,
  id: "draft-1",
  status: "pending",
  structured_output: { answer: "draft" },
  target_id: "record-1",
  target_type: "note",
  target_version: 1,
  updated_at: "2026-08-01T00:00:00Z",
  version: 1,
};

beforeEach(() => {
  request.mockReset();
  window.history.replaceState(null, "", "/app/ai");
  request.mockImplementation(async (path: string) => {
    if (path === "/api/v1/workspaces") return { workspaces: [workspace] };
    if (path.endsWith("/ai/runs")) return { runs: [] };
    if (path.endsWith("/ai/drafts")) return { drafts: [draft] };
    if (path.includes("/ai/providers")) return { providers: [] };
    if (path.includes("/ai/models")) return { models: [] };
    if (path.includes("/ai/routes")) return { routes: [] };
    if (path.includes("/ai/budget")) return { monthly_token_budget: null };
    return {};
  });
});

describe("AI governance workbench", () => {
  it("exposes a route-specific workbench with one empty-state primary", () => {
    const { container } = render(<AIRunCenter />);

    expect(screen.getByText("DRAFT REVIEW")).toBeTruthy();
    expect(screen.getByText("发送边界")).toBeTruthy();
    expect(
      container.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(container.querySelector('[data-testid="ai-drafts"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ai-review"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ai-source"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ai-runs"]')).toBeTruthy();
    expect(container.querySelector(".planning-form")).toBeNull();
    expect(container.textContent).not.toContain("ProductPanel");
  });

  it("keeps provider credentials out of the rendered document and opens settings in a sheet", async () => {
    const { container } = render(<ProviderCenter />);

    expect(screen.getByText("模型连接与任务路由")).toBeTruthy();
    expect(container.querySelector('[data-testid="ai-provider"]')).toBeTruthy();
    expect(
      container.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getAllByRole("button", { name: "新增 Provider" })[0]!,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("API 密钥").getAttribute("value")).toBeNull();
    expect(document.body.textContent).not.toContain("sk-test-secret");
  });

  it("offers re-authentication when the server requires recent authentication", async () => {
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces") return { workspaces: [workspace] };
      if (path.endsWith("/ai/runs")) {
        throw new (await import("@/lib/api/client")).LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          message: "Sign in again before changing authentication methods.",
          requestId: "request-recent-auth",
          status: 403,
        });
      }
      if (path.endsWith("/ai/drafts")) return { drafts: [] };
      return {};
    });

    render(<AIRunCenter />);

    await waitFor(() =>
      expect(screen.getAllByText(/需要重新认证/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/request-recent-auth/).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByRole("link", { name: "重新认证" }).getAttribute("href"),
    ).toBe("/auth/login?next=/app/ai");
    expect(screen.queryByText(/当前角色无权使用 AI/)).toBeNull();
  });

  it("clears the re-authentication prompt after a successful refresh", async () => {
    let shouldFail = true;
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces") return { workspaces: [workspace] };
      if (path.endsWith("/ai/runs") && shouldFail) {
        throw new (await import("@/lib/api/client")).LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          message: "Sign in again before changing authentication methods.",
          requestId: "request-recent-auth",
          status: 403,
        });
      }
      if (path.endsWith("/ai/runs")) return { runs: [] };
      if (path.endsWith("/ai/drafts")) return { drafts: [] };
      return {};
    });

    render(<AIRunCenter />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "重新认证" })).toBeTruthy(),
    );

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "重新认证" })).toBeNull(),
    );
  });

  it("clears the Provider re-authentication prompt after a successful refresh", async () => {
    let shouldFail = true;
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces") return { workspaces: [workspace] };
      if (path.includes("/ai/providers") && shouldFail) {
        throw new (await import("@/lib/api/client")).LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          message: "Sign in again before changing authentication methods.",
          requestId: "request-recent-auth",
          status: 403,
        });
      }
      if (path.includes("/ai/providers")) return { providers: [] };
      if (path.includes("/ai/models")) return { models: [] };
      if (path.includes("/ai/routes")) return { routes: [] };
      if (path.includes("/ai/budget")) return { monthly_token_budget: null };
      return {};
    });

    render(<ProviderCenter />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "重新认证" })).toBeTruthy(),
    );

    shouldFail = false;
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "重新认证" })).toBeNull(),
    );
  });

  it("keeps top-level AI navigation limited to mounted views", () => {
    const { container } = render(<AIWorkbenchPage />);
    expect(container.querySelectorAll("nav a")).toHaveLength(0);
    expect(screen.getByRole("tablist", { name: "AI 工作区视图" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Draft" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Provider" })).toBeTruthy();
    for (const tab of screen.getAllByRole("tab")) {
      const controls = tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls!)).toBeTruthy();
    }

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Provider" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(
      screen.getByRole("tab", { name: "Provider" }).getAttribute("data-state"),
    ).toBe("active");
    expect(window.location.hash).toBe("#ai-provider-center");
    expect(container.querySelector('a[href="#ai-budget-center"]')).toBeNull();
    expect(container.querySelector('a[href="#ai-route-center"]')).toBeNull();
  });

  it("keeps a real AI permission failure separate from recent authentication", async () => {
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces") return { workspaces: [workspace] };
      if (path.endsWith("/ai/runs")) {
        throw new (await import("@/lib/api/client")).LogionApiError({
          code: "AI_WORKSPACE_FORBIDDEN",
          message: "Workspace role cannot run AI.",
          requestId: "request-ai-forbidden",
          status: 403,
        });
      }
      if (path.endsWith("/ai/drafts")) return { drafts: [] };
      return {};
    });

    render(<AIRunCenter />);

    await waitFor(() =>
      expect(
        screen.getAllByText(/当前角色无权使用 AI；请联系 Workspace 管理员/)
          .length,
      ).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/或需要重新验证身份/)).toBeNull();
  });

  it("uses the selected draft main action to approve without leaving the workbench", async () => {
    render(<AIRunCenter />);

    await waitFor(() => expect(screen.getByText("note")).toBeTruthy());
    expect(screen.getAllByRole("button", { name: "批准草稿" })).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "批准草稿" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/api/v1/workspaces/workspace-1/ai/drafts/draft-1/decision",
        expect.objectContaining({
          body: expect.stringContaining('"decision":"accepted"'),
          method: "POST",
        }),
      ),
    );
  });
});
