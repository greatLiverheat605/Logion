import { describe, expect, it } from "vitest";

import {
  groupNotifications,
  notificationSummary,
} from "./notification-center-model";

const receipt = (
  id: string,
  overrides: Partial<Parameters<typeof notificationSummary>[0][number]> = {},
) => ({
  id,
  workspace_id: "a",
  category: "sync" as const,
  title: "同步推送回执",
  summary: "服务端已接收 2 项；待处理冲突 0 项；未接收 0 项；已解决冲突 0 项。",
  created_at: "2026-09-01T00:00:00Z",
  read_at: null,
  target_id: null,
  target_type: "sync",
  ...overrides,
});

it("groups ordinary receipts without conflating read counts, workspaces or original IDs", () => {
  const rows = [
    receipt("1"),
    receipt("2", { read_at: "2026-09-02T00:00:00Z" }),
    receipt("1"),
    receipt("1", { workspace_id: "b" }),
  ];
  const grouped = groupNotifications(rows);
  expect(grouped).toHaveLength(2);
  expect(grouped[0]?.members.map((item) => item.id)).toEqual(["1", "2"]);
  expect(grouped[0]?.unreadCount).toBe(1);
  expect(notificationSummary(rows)).toMatchObject({ total: 3, unread: 2 });
  expect(grouped[0]?.summary).toContain("设备应用结果请查看同步中心");
});

it("keeps conflict, rejection, resolved-conflict, unknown and security messages independent", () => {
  const rows = [
    receipt("1"),
    receipt("2"),
    receipt("conflict", {
      summary:
        "服务端已接收 2 项；待处理冲突 1 项；未接收 0 项；已解决冲突 0 项。",
    }),
    receipt("reject", {
      summary:
        "服务端已接收 2 项；待处理冲突 0 项；未接收 1 项；已解决冲突 0 项。",
    }),
    receipt("resolved", {
      summary:
        "服务端已接收 2 项；待处理冲突 0 项；未接收 0 项；已解决冲突 1 项。",
    }),
    receipt("unknown", { summary: "未知格式：同步失败" }),
    receipt("security", { category: "security" }),
    receipt("target", { target_type: null }),
  ];
  const groups = groupNotifications(rows);
  expect(groups).toHaveLength(7);
  expect(groups.slice(1).every((group) => group.members.length === 1)).toBe(
    true,
  );
});

it("keeps pull receipts separate from accepted pushes and retains their limited meaning", () => {
  const pull = {
    title: "同步拉取回执",
    summary: "服务端返回 3 条变更；设备应用结果请查看同步中心。",
  };
  const groups = groupNotifications([
    receipt("push"),
    receipt("pull1", pull),
    receipt("pull2", pull),
  ]);
  expect(groups).toHaveLength(2);
  expect(groups[1]?.members).toHaveLength(2);
  expect(groups[1]?.summary).not.toContain("已同步");
});

describe("notification center summary", () => {
  it("uses the same supported categories and unread rule as the full center", () => {
    const notifications: Parameters<typeof notificationSummary>[0] = [
      {
        created_at: "2026-07-31T08:00:00Z",
        category: "security",
        id: "notification-security",
        read_at: null,
        summary: "新的登录活动",
        target_id: null,
        target_type: null,
        title: "安全提醒",
        workspace_id: "workspace-1",
      },
      {
        created_at: "2026-07-30T08:00:00Z",
        category: "learning",
        id: "notification-learning",
        read_at: "2026-07-30T08:00:00Z",
        summary: "复习任务到期",
        target_id: null,
        target_type: null,
        title: "学习提醒",
        workspace_id: "workspace-1",
      },
      {
        created_at: "2026-07-29T08:00:00Z",
        category: "billing",
        id: "notification-billing",
        read_at: null,
        summary: "账单信息",
        target_id: null,
        target_type: null,
        title: "未知提醒",
        workspace_id: "workspace-1",
      },
    ];
    const summary = notificationSummary(notifications);
    expect(summary.total).toBe(2);
    expect(summary.unread).toBe(1);
    expect(summary.latest.map((item) => item.title)).toEqual([
      "安全提醒",
      "学习提醒",
    ]);
  });
});
