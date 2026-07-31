import { describe, expect, it } from "vitest";

import { notificationSummary } from "./notification-center-model";

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
