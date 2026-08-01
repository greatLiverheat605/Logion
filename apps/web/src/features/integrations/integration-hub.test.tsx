/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogionApiError } from "@/lib/api/client";

import { IntegrationHub } from "./integration-hub";
import type {
  CalendarFeed,
  DataExport,
  DataImport,
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
  workspaces = [workspace],
}: {
  exports?: DataExport[];
  feeds?: CalendarFeed[];
  imports?: DataImport[];
  workspaces?: Workspace[];
} = {}) {
  return {
    listCalendarFeeds: vi.fn(() => Promise.resolve(feeds)),
    listWorkspaces: vi.fn(() => Promise.resolve(workspaces)),
    loadPortability: vi.fn(() =>
      Promise.resolve({ exports, imports, privateSpaces: [] }),
    ),
  };
}

describe("IntegrationHub", () => {
  it("shows loading and unsupported boundaries without fake connector state", () => {
    render(
      <IntegrationHub
        service={{
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
            { status: "active" },
            { status: "revoked" },
          ] as CalendarFeed[],
          imports: [
            { status: "previewed" },
            { status: "imported" },
          ] as DataImport[],
          exports: [
            { status: "succeeded" },
            { status: "running" },
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
});
