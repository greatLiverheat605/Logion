/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchWorkbench } from "./search-workbench";
import type {
  SearchControllerResult,
  SearchDisplayResult,
  SearchScope,
} from "./use-search-controller";

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

function searchResult(
  id: string,
  objectType: SearchDisplayResult["object_type"],
): SearchDisplayResult {
  return {
    object_id: id,
    object_type: objectType,
    permission_source: objectType === "task" ? "shared_space" : "private_owner",
    snippet: `${id} 的匹配片段`,
    space_id: "space-1",
    title: id,
    updated_at: "2026-08-26T00:00:00.000Z",
    workspace_id: "workspace-1",
  };
}

function controllerFixture({ empty = false }: { empty?: boolean } = {}) {
  const goal = searchResult("分布式系统目标", "goal");
  const task = searchResult("完成 Raft 精读", "task");
  const commands = {
    createFeed: vi.fn(async () => "calendar-token"),
    loadContext: vi.fn(async () => undefined),
    markRead: vi.fn(async () => true),
    resetSearch: vi.fn(),
    revokeFeed: vi.fn(async () => true),
    savePreferences: vi.fn(async () => true),
    search: vi.fn(async () => true),
    selectResult: vi.fn(),
    setWorkspaceId: vi.fn(),
    unlock: vi.fn(async () => true),
  };
  const groups = empty
    ? []
    : [
        { items: [goal], type: "goal" as const },
        { items: [task], type: "task" as const },
      ];
  const controller: SearchControllerResult = {
    capabilities: {
      canManageUtilities: true,
      canSearch: true,
      canUnlock: false,
    },
    commands,
    context: {
      offlineUnlocked: true,
      online: true,
      operational: {
        permission: { label: "owner", tone: "good" },
        sync: { label: "服务器权限过滤", tone: "good" },
        vault: { label: "已解锁", tone: "good" },
        workspace: { id: "workspace-1", name: "Logion" },
      },
      operationalState: null,
      status: empty ? "搜索完成，没有匹配结果。" : "搜索完成，找到 2 条结果。",
      workspaceId: "workspace-1",
      workspaces: [
        { id: "workspace-1", name: "Logion", role: "owner" },
      ] as SearchControllerResult["context"]["workspaces"],
    },
    search: {
      groups,
      lastQuery: "Raft",
      phase: "ready",
      resultCount: empty ? 0 : 2,
      searched: true,
      selectedResult: empty ? null : goal,
    },
    utilities: {
      activeFeedCount: 1,
      feeds: [
        {
          created_at: "2026-08-26T00:00:00.000Z",
          id: "feed-1",
          name: "学习截止事项",
          status: "active",
          version: 1,
        },
      ] as SearchControllerResult["utilities"]["feeds"],
      notifications: [],
      preference: null,
      spaces: [
        { id: "space-1", name: "私有空间" },
      ] as SearchControllerResult["utilities"]["spaces"],
      unreadNotificationCount: 0,
    },
  };
  return { commands, controller };
}

function Harness({ empty = false }: { empty?: boolean }) {
  const { controller } = controllerFixture({ empty });
  const scope: SearchScope = "all";
  return (
    <SearchWorkbench
      controller={controller}
      onScopeChange={vi.fn()}
      scope={scope}
    />
  );
}

describe("Search workbench", () => {
  it("renders the five GLM regions with one visible primary", () => {
    render(<Harness />);

    expect(screen.getByTestId("search-command")).toBeTruthy();
    expect(screen.getByTestId("search-modes")).toBeTruthy();
    expect(screen.getByTestId("search-results")).toBeTruthy();
    expect(screen.getByTestId("search-preview")).toBeTruthy();
    expect(screen.getByTestId("search-utilities")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("moves result focus and selection with Arrow keys", () => {
    const { commands, controller } = controllerFixture();
    render(
      <SearchWorkbench
        controller={controller}
        onScopeChange={vi.fn()}
        scope="all"
      />,
    );
    const rows = screen.getAllByRole("button", { name: /匹配片段/ });
    rows[0]?.focus();
    fireEvent.keyDown(rows[0]!, { key: "ArrowDown" });

    expect(document.activeElement).toBe(rows[1]);
    expect(commands.selectResult).toHaveBeenLastCalledWith("完成 Raft 精读");
  });

  it("promotes clear filters to the only primary after an empty search", () => {
    const { commands, controller } = controllerFixture({ empty: true });
    render(
      <SearchWorkbench
        controller={controller}
        onScopeChange={vi.fn()}
        scope="all"
      />,
    );

    expect(
      document.querySelectorAll('[data-workbench-primary="true"]'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(commands.resetSearch).toHaveBeenCalledOnce();
  });

  it("requires explicit impact confirmation before revoking a calendar URL", async () => {
    const { commands, controller } = controllerFixture();
    render(
      <SearchWorkbench
        controller={controller}
        onScopeChange={vi.fn()}
        scope="all"
      />,
    );
    fireEvent.keyDown(screen.getByRole("tab", { name: "搜索" }), {
      code: "End",
      key: "End",
    });
    fireEvent.click(await screen.findByRole("button", { name: "撤销" }));

    const revoke = await screen.findByRole("button", { name: "永久撤销 URL" });
    expect(revoke).toHaveProperty("disabled", true);
    fireEvent.change(
      screen.getByRole("textbox", { name: "输入 REVOKE 确认" }),
      {
        target: { value: "REVOKE" },
      },
    );
    expect(revoke).toHaveProperty("disabled", false);
    fireEvent.click(revoke);
    await waitFor(() => expect(commands.revokeFeed).toHaveBeenCalledOnce());
  });

  it("keeps unread notification handling reachable from the notifications tab", async () => {
    const { commands, controller } = controllerFixture();
    const notification = {
      category: "learning" as const,
      created_at: "2026-08-26T00:00:00.000Z",
      id: "notification-1",
      read_at: null,
      summary: "阶段复习已到期",
      target_id: "task-1",
      target_type: "task",
      title: "复习提醒",
      workspace_id: "workspace-1",
    };
    controller.utilities.notifications = [notification];
    controller.utilities.unreadNotificationCount = 1;
    render(
      <SearchWorkbench
        controller={controller}
        onScopeChange={vi.fn()}
        scope="all"
      />,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "搜索" }), {
      code: "ArrowRight",
      key: "ArrowRight",
    });
    fireEvent.click(await screen.findByRole("button", { name: "标为已读" }));

    await waitFor(() =>
      expect(commands.markRead).toHaveBeenCalledWith(notification),
    );
  });

  it("opens the mobile result preview as a dismissible Sheet and restores focus", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { controller } = controllerFixture();
    render(
      <SearchWorkbench
        controller={controller}
        onScopeChange={vi.fn()}
        scope="all"
      />,
    );
    const result = screen.getAllByRole("button", { name: /匹配片段/ })[0]!;
    result.focus();
    fireEvent.click(result);

    const preview = await screen.findByRole("dialog", { name: "搜索结果预览" });
    expect(preview).toBeTruthy();
    fireEvent.keyDown(preview, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "搜索结果预览" })).toBeNull();
      expect(document.activeElement).toBe(result);
    });
  });
});
