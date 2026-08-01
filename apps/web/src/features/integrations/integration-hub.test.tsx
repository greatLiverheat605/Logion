/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import { IntegrationHub } from "./integration-hub";
import type {
  CalendarFeed,
  DataExport,
  DataImport,
  Space,
  Workspace,
} from "./integration-capability-model";

afterEach(cleanup);

const workspace: Workspace = {
  created_at: "2026-08-01T00:00:00Z",
  id: "workspace-1",
  membership_status: "active",
  name: "个人工作区",
  role: "owner",
  status: "active",
  updated_at: "2026-08-01T00:00:00Z",
  version: 1,
};

function serviceWith({
  feeds = [],
  imports = [],
  exports = [],
  privateSpaces = [],
  workspaces = [workspace],
}: {
  exports?: DataExport[];
  feeds?: CalendarFeed[];
  imports?: DataImport[];
  privateSpaces?: Space[];
  workspaces?: Workspace[];
} = {}) {
  return {
    cancelExport: vi.fn(() => Promise.resolve({} as DataExport)),
    commitImport: vi.fn(() => Promise.resolve({} as DataImport)),
    createCalendarFeed: vi.fn(() =>
      Promise.resolve({ token: "one-time-token" }),
    ),
    createExport: vi.fn(() => Promise.resolve({} as DataExport)),
    listCalendarFeeds: vi.fn(() => Promise.resolve(feeds)),
    listWorkspaces: vi.fn(() => Promise.resolve(workspaces)),
    loadPortability: vi.fn(() =>
      Promise.resolve({ exports, imports, privateSpaces }),
    ),
    previewImport: vi.fn(() => Promise.resolve({} as DataImport)),
    revokeCalendarFeed: vi.fn(() => Promise.resolve({})),
  };
}

describe("IntegrationHub", () => {
  it("shows loading and unsupported boundaries without fake connector state", () => {
    render(
      <IntegrationHub
        service={{
          ...serviceWith(),
          listCalendarFeeds: vi.fn(() => Promise.resolve([])),
          listWorkspaces: vi.fn(() => new Promise<Workspace[]>(() => {})),
          loadPortability: vi.fn(() =>
            Promise.resolve({ exports: [], imports: [], privateSpaces: [] }),
          ),
        }}
      />,
    );

    expect(screen.getByText("正在准备互操作状态")).toBeTruthy();
    expect(screen.getByText("通用连接器与自动化")).toBeTruthy();
    expect(screen.getByText("Zotero 账号同步与 OAuth 尚未开放。")).toBeTruthy();
    expect(screen.queryByText("已连接")).toBeNull();
  });

  it("distinguishes missing context from an empty workspace", async () => {
    const { rerender } = render(
      <IntegrationHub service={serviceWith({ workspaces: [] })} />,
    );
    expect(await screen.findByText("尚无可访问工作区")).toBeTruthy();

    rerender(<IntegrationHub service={serviceWith()} />);
    expect(await screen.findByText("当前工作区尚无互操作记录")).toBeTruthy();
  });

  it("renders ready metrics from real response records", async () => {
    render(
      <IntegrationHub
        service={serviceWith({
          feeds: [
            { id: "feed-active", name: "Active", status: "active", version: 1 },
            {
              id: "feed-revoked",
              name: "Revoked",
              status: "revoked",
              version: 2,
            },
          ] as CalendarFeed[],
          imports: [
            {
              counts: {},
              id: "import-previewed",
              source_filename: "preview.md",
              status: "previewed",
              version: 1,
              warnings: [],
            },
            {
              counts: {},
              id: "import-imported",
              source_filename: "imported.md",
              status: "imported",
              version: 2,
              warnings: [],
            },
          ] as unknown as DataImport[],
          exports: [
            {
              artifact_bytes: 10,
              expires_at: "2026-08-02T00:00:00Z",
              id: "export-succeeded",
              status: "succeeded",
              version: 1,
            },
            {
              artifact_bytes: null,
              expires_at: "2026-08-02T00:00:00Z",
              id: "export-running",
              status: "running",
              version: 2,
            },
          ] as DataExport[],
        })}
      />,
    );

    const calendarMetric = await screen.findByText("有效日历 Feed");
    expect(calendarMetric.parentElement?.textContent).toContain("11 个已撤销");
    expect(screen.getByText("待确认导入").parentElement?.textContent).toContain(
      "11 个已提交",
    );
    expect(screen.getByText("成功导出").parentElement?.textContent).toContain(
      "12 个全部任务",
    );
  });

  it("shows request metadata when loading fails", async () => {
    const service = serviceWith();
    service.listWorkspaces.mockRejectedValue(
      new LogionApiError({
        code: "WORKSPACE_LIST_FAILED",
        message: "failed",
        requestId: "request-hub",
        status: 503,
      }),
    );
    render(<IntegrationHub service={service} />);

    expect(await screen.findByText(/WORKSPACE_LIST_FAILED/)).toBeTruthy();
    expect(screen.getByText(/request-hub/)).toBeTruthy();
    expect(screen.getByText("互操作状态暂时不可用")).toBeTruthy();
  });

  it("creates an ephemeral Calendar URL and revokes an active feed", async () => {
    const service = serviceWith({
      feeds: [
        {
          id: "feed-1",
          name: "学习日历",
          status: "active",
          version: 3,
        },
      ] as CalendarFeed[],
    });
    render(<IntegrationHub service={service} />);

    fireEvent.change(await screen.findByLabelText("订阅名称"), {
      target: { value: "研究安排" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建日历订阅" }));

    const oneTimeUrl = await screen.findByRole("link", {
      name: /one-time-token/,
    });
    expect(oneTimeUrl.getAttribute("href")).toBe(
      "/api/v1/calendars/one-time-token.ics",
    );
    expect(service.createCalendarFeed).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ name: "研究安排" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭一次性 URL" }));
    expect(screen.queryByRole("link", { name: /one-time-token/ })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));
    expect(service.revokeCalendarFeed).toHaveBeenCalledWith(
      "workspace-1",
      "feed-1",
      3,
    );
  });

  it("previews and commits an import only to a private target", async () => {
    const service = serviceWith({
      imports: [
        {
          counts: { notes: 1 },
          id: "import-1",
          source_filename: "preview.md",
          status: "previewed",
          version: 4,
          warnings: [],
        },
      ] as unknown as DataImport[],
      privateSpaces: [
        { id: "private-space", name: "我的资料", visibility: "private" },
      ] as Space[],
    });
    render(<IntegrationHub service={service} />);

    fireEvent.change(await screen.findByLabelText("内容（最大 1 MiB）"), {
      target: { value: "# Imported note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成导入预览" }));
    await waitFor(() => expect(service.previewImport).toHaveBeenCalled());
    expect(service.previewImport).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({
        content: "# Imported note",
        source_filename: "import.md",
        source_format: "markdown",
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "确认 IMPORT" }));
    await waitFor(() => expect(service.commitImport).toHaveBeenCalled());
    expect(service.commitImport).toHaveBeenCalledWith(
      "workspace-1",
      "import-1",
      { expected_version: 4, target_space_id: "private-space" },
    );
  });

  it("creates, downloads and cancels exports while surfacing recent auth", async () => {
    const service = serviceWith({
      exports: [
        {
          artifact_bytes: null,
          expires_at: "2026-08-02T00:00:00Z",
          id: "export-queued",
          status: "queued",
          version: 2,
        },
        {
          artifact_bytes: 128,
          artifact_sha256: "sha256-value",
          expires_at: "2026-08-02T00:00:00Z",
          id: "export-ready",
          status: "succeeded",
          version: 3,
        },
      ] as DataExport[],
    });
    service.createExport.mockRejectedValueOnce(
      new LogionApiError({
        code: "AUTH_RECENT_LOGIN_REQUIRED",
        message: "sign in again",
        requestId: "request-auth",
        status: 403,
      }),
    );
    render(<IntegrationHub service={service} />);

    fireEvent.change(await screen.findByLabelText("输入 EXPORT 确认创建"), {
      target: { value: "EXPORT" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建加密导出" }));
    expect(
      await screen.findByText("需要重新登录后才能创建数据导出。"),
    ).toBeTruthy();

    const download = screen.getByRole("link", { name: "下载" });
    expect(download.getAttribute("href")).toBe(
      "/api/v1/workspaces/workspace-1/data-exports/export-ready/download",
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(service.cancelExport).toHaveBeenCalled());
    expect(service.cancelExport).toHaveBeenCalledWith(
      "workspace-1",
      "export-queued",
      2,
    );
  });
});
