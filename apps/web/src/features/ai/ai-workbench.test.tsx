/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
import { LogionApiError } from "@/lib/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
  vi.clearAllMocks();
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
  it("does not overwrite a failed post-discovery refresh with success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fallback = request.getMockImplementation()!;
    let discovered = false;
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/discover-models")) {
        discovered = true;
        return { model_count: 1 };
      }
      if (path.endsWith("/ai/providers")) {
        if (discovered)
          throw new LogionApiError({
            code: "WEB_NETWORK_UNAVAILABLE",
            status: 503,
            requestId: "refresh-failed",
            message: "Private detail",
          });
        return {
          providers: [
            {
              id: "provider-1",
              name: "Test Provider",
              enabled: true,
              version: 1,
            },
          ],
        };
      }
      return fallback(path);
    });
    render(<ProviderCenter />);
    const button = await screen.findByRole("button", {
      name: "测试并发现模型",
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("refresh-failed"),
        { duration: Infinity, closeButton: true },
      ),
    );
    expect(document.body.textContent).toContain("refresh-failed");
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("reports successful Provider discovery through Toast and inline status", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fallback = request.getMockImplementation()!;
    request.mockImplementation(async (path: string) => {
      if (path.endsWith("/discover-models")) return { model_count: 2 };
      if (path.endsWith("/ai/providers"))
        return {
          providers: [
            {
              id: "provider-1",
              name: "Test Provider",
              enabled: true,
              credential_configured: true,
              version: 1,
            },
          ],
        };
      return fallback(path);
    });
    render(<ProviderCenter />);
    const button = await screen.findByRole("button", {
      name: "测试并发现模型",
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    fireEvent.click(button);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "连接检查成功，发现 2 个模型。",
        { duration: 3000 },
      ),
    );
    expect(document.body.textContent).toContain(
      "连接检查成功，发现 2 个模型。",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([false, true, "refresh"] as const)(
    "F3 Run submission preserves inline status and emits the matching Toast (failure=%s)",
    async (failure) => {
      const fallback = request.getMockImplementation()!;
      let submitted = false;
      let finishSubmission: (() => void) | undefined;
      request.mockImplementation(
        async (path: string, options?: { method?: string }) => {
          if (path.endsWith("/ai/runs") && submitted && failure === "refresh")
            throw new LogionApiError({
              code: "AI_REFRESH_UNAVAILABLE",
              status: 503,
              requestId: "request-refresh",
              message: "Unavailable",
            });
          if (path.endsWith("/route-resolution-preview"))
            return {
              candidates: [{ provider_id: "provider-1", model_id: "model-1" }],
              estimated_input_tokens: 10,
              requested_output_tokens: 100,
              budget: {
                monthly_token_budget: null,
                used_tokens: 0,
                reserved_tokens: 0,
              },
            };
          if (path.endsWith("/ai/runs") && options?.method === "POST") {
            await new Promise<void>((resolve) => {
              finishSubmission = resolve;
            });
            if (failure === true)
              throw new LogionApiError({
                code: "AI_ROUTE_UNAVAILABLE",
                status: 503,
                requestId: "request-run",
                message: "Unavailable",
              });
            submitted = true;
            return { status: "queued" };
          }
          return fallback(path);
        },
      );
      render(<AIRunCenter />);
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "创建结构化草稿" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "创建结构化草稿" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(
        screen.getByLabelText("我已明确选择并核对上述发送来源与内容范围"),
      );
      fireEvent.submit(dialog.querySelector("form")!);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      vi.mocked(toast.success).mockClear();
      fireEvent.click(
        screen.getByLabelText(
          "我确认上述数据范围、Provider、模型与预算信息，可以发送",
        ),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "确认并发送到 Provider" }),
      );
      expect(
        screen
          .getByRole("button", { name: "取消发送" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(
        screen
          .getByRole("button", { name: "正在提交…" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(finishSubmission).toBeTypeOf("function");
      finishSubmission!();
      const text =
        failure === "refresh"
          ? "AI_REFRESH_UNAVAILABLE"
          : failure
            ? "AI_ROUTE_UNAVAILABLE"
            : "AI 运行已入队";
      await waitFor(() => expect(document.body.textContent).toContain(text));
      expect(failure ? toast.error : toast.success).toHaveBeenCalledWith(
        expect.stringContaining(text),
        failure
          ? { duration: Infinity, closeButton: true }
          : { duration: 3000 },
      );
      if (failure) expect(toast.success).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      code: "AI_PROVIDER_DNS_UNRESOLVABLE",
      details: { hostname: "api.example.com", resolved_count: 0 },
      expected: "无法解析 Provider 域名（api.example.com）",
    },
    {
      code: "AI_PROVIDER_DNS_UNRESOLVABLE",
      details: undefined,
      expected:
        "无法解析 Provider 域名，请检查服务端网络或 Provider 配置；可重试。",
    },
    {
      code: "AI_PROVIDER_DNS_UNRESOLVABLE",
      details: { hostname: null, resolved_count: 0 },
      expected:
        "无法解析 Provider 域名，请检查服务端网络或 Provider 配置；可重试。",
    },
    {
      code: "AI_PROVIDER_DNS_BLOCKED",
      details: { hostname: "api.example.com", resolved_count: 2 },
      expected: "Provider 域名解析结果包含非公网地址，连接已阻止。",
    },
    {
      code: "AI_PROVIDER_DNS_BLOCKED",
      details: undefined,
      expected: "Provider DNS 检查未通过，请检查服务端网络或 Provider 配置。",
    },
    {
      code: "AI_PROVIDER_DNS_BLOCKED",
      details: { hostname: {}, resolved_count: "2" },
      expected: "Provider DNS 检查未通过，请检查服务端网络或 Provider 配置。",
    },
  ])(
    "distinguishes discovery DNS feedback: $code / $expected",
    async ({ code, details, expected }) => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const fallback = request.getMockImplementation()!;
      let lastError: string | null = null;
      request.mockImplementation(async (path: string) => {
        if (path.endsWith("/discover-models")) {
          lastError = code;
          throw new LogionApiError({
            code,
            details,
            message: "Provider failed.",
            requestId: "request-dns-check",
            status: code === "AI_PROVIDER_DNS_UNRESOLVABLE" ? 503 : 422,
          });
        }
        if (path.endsWith("/ai/providers"))
          return {
            providers: [
              {
                id: "provider-1",
                name: "Test Provider",
                base_url: "https://api.example.com/v1",
                enabled: true,
                credential_configured: true,
                version: 1,
                last_health_status: lastError ? "unhealthy" : "unknown",
                last_health_error_code: lastError,
              },
            ],
          };
        return fallback(path);
      });
      render(<ProviderCenter />);
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "测试并发现模型" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "测试并发现模型" }));
      await waitFor(() => {
        const feedback = document.querySelector(
          '[aria-live="polite"]',
        )?.textContent;
        expect(feedback).toContain(expected);
        expect(feedback).toContain(code);
        expect(feedback).toContain("request-dns-check");
      });
      expect(document.body.textContent).not.toContain("连接检查成功");
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(code), {
        duration: Infinity,
        closeButton: true,
      });
      expect(toast.success).not.toHaveBeenCalled();
      if (
        code !== "AI_PROVIDER_DNS_BLOCKED" ||
        !details ||
        typeof details.resolved_count !== "number"
      ) {
        expect(document.body.textContent).not.toContain("包含非公网地址");
      }
      fireEvent.click(screen.getByRole("button", { name: "刷新" }));
      await waitFor(() =>
        expect(screen.queryByText(/request-dns-check/)).toBeNull(),
      );
      expect(document.body.textContent).toContain(
        code === "AI_PROVIDER_DNS_UNRESOLVABLE"
          ? "无法解析 Provider 域名"
          : "Provider DNS 检查未通过",
      );
      expect(document.body.textContent).not.toContain("包含非公网地址");
    },
  );

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
