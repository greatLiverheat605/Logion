/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/api/client")>(
      "@/lib/api/client",
    );
  return { ...actual, browserApiClient: { request } };
});

import { GrowthCenter } from "./growth-center";
import { LogionApiError } from "@/lib/api/client";

afterEach(cleanup);

describe("Templates workbench", () => {
  it("renders a dedicated category master, detail main and inspector shell", () => {
    const html = renderToStaticMarkup(<GrowthCenter />);

    expect(html).toContain('data-testid="templates-category-master"');
    expect(html).toContain('data-testid="templates-detail-main"');
    expect(html).toContain('data-testid="templates-inspector"');
    expect(html).toContain("安装预览");
    expect(html).toContain("模板风险与来源");
    expect(html).not.toContain("product-template-workbench");
    expect(html).not.toContain("planning-form");
    expect(html.match(/data-workbench-primary="true"/g)).toHaveLength(1);
  });

  it("keeps low-frequency creation, import and sharing behind sheet entry points", () => {
    const html = renderToStaticMarkup(<GrowthCenter />);

    expect(html).toContain("创建模板");
    expect(html).toContain("导入模板包");
    expect(html).toContain("创建只读分享");
    expect(html).toContain('data-template-sheet="create"');
    expect(html).toContain('data-template-sheet="import"');
    expect(html).toContain('data-template-sheet="share"');
  });

  it("labels the official catalog and explains its read-only action boundary", () => {
    const html = renderToStaticMarkup(<GrowthCenter />);

    expect(html).toContain("官方模板");
    expect(html).toContain("Logion 官方");
    expect(html).toContain("安装独立副本");
    expect(html).toContain("官方模板不可编辑、分享或撤销");
  });

  it("offers re-authentication when a template write is outside the recent-auth window", async () => {
    request.mockReset();
    request.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces") {
        return {
          workspaces: [
            {
              created_at: "2026-08-01T00:00:00Z",
              id: "workspace-1",
              membership_status: "active",
              name: "个人工作区",
              role: "owner",
              status: "active",
              updated_at: "2026-08-01T00:00:00Z",
              version: 1,
            },
          ],
        };
      }
      if (path.endsWith("/templates")) {
        throw new LogionApiError({
          code: "AUTH_RECENT_LOGIN_REQUIRED",
          message: "Sign in again before changing authentication methods.",
          requestId: "request-recent-auth",
          status: 403,
        });
      }
      if (path.endsWith("/spaces")) return { spaces: [] };
      if (path.endsWith("/shares")) return { shares: [] };
      return {};
    });

    render(<GrowthCenter />);

    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([path]) => path === "/api/v1/workspaces/workspace-1/templates",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getAllByText(/需要重新认证/).length).toBeGreaterThan(0),
    );
    expect(
      screen.getByRole("link", { name: "重新认证" }).getAttribute("href"),
    ).toBe("/auth/login?next=/app/templates");
    expect(
      screen.queryByText("当前角色或 Space 权限不允许此操作。"),
    ).toBeNull();
  });
});
