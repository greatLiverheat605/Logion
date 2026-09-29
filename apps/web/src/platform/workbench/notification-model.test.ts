import { describe, expect, it } from "vitest";
import {
  actionUnreadCount,
  notificationPresentation,
  type Notification,
} from "./notification-model";

const notification = (value: Partial<Notification>): Notification => ({
  id: "synthetic",
  workspace_id: "synthetic-workspace",
  category: "sync",
  title: "同步推送回执",
  summary: "服务端已接收 2 项；待处理冲突 0 项；未接收 0 项；已解决冲突 0 项。",
  target_type: "sync",
  target_id: null,
  read_at: null,
  created_at: "2026-09-29T00:00:00Z",
  ...value,
});

describe("action-only notifications", () => {
  it("keeps routine success and resolved conflicts out of the unread badge", () => {
    const rows = [
      notification({}),
      notification({
        summary:
          "服务端已接收 2 项；待处理冲突 0 项；未接收 0 项；已解决冲突 1 项。",
      }),
      notification({
        title: "同步拉取回执",
        summary: "服务端返回 2 条变更；设备应用结果请查看同步中心。",
      }),
      notification({
        category: "collaboration",
        target_type: "share_snapshot",
      }),
      notification({ category: "system", target_type: "unknown" }),
      notification({ summary: "unknown producer text" }),
    ];
    expect(actionUnreadCount(rows)).toBe(0);
    expect(rows.map(notificationPresentation)).toHaveLength(rows.length);
    expect(
      rows
        .map(notificationPresentation)
        .every((row) => !row.action && !row.href),
    ).toBe(true);
  });
  it("counts only unread action events and preserves explicit routing", () => {
    const rows = [
      notification({
        summary:
          "服务端已接收 2 项；待处理冲突 1 项；未接收 0 项；已解决冲突 0 项。",
      }),
      notification({
        summary:
          "服务端已接收 0 项；待处理冲突 0 项；未接收 1 项；已解决冲突 0 项。",
      }),
      notification({ category: "security" }),
      notification({ category: "learning", target_type: "review" }),
      notification({ category: "ai", target_type: "ai_run" }),
      notification({ category: "system", target_type: "data_export" }),
    ];
    expect(actionUnreadCount(rows)).toBe(6);
    expect(
      actionUnreadCount(
        rows.map((row) => ({ ...row, read_at: row.created_at })),
      ),
    ).toBe(0);
    expect(notificationPresentation(rows[0]!).href).toBe(
      "/app/sync?legacy=sync&workspace=synthetic-workspace",
    );
    expect(notificationPresentation(rows[3]!).href).toBe("/review");
    expect(notificationPresentation(rows[4]!).title).toBe("AI 草稿已就绪");
    expect(notificationPresentation(rows[5]!).href).toBe("/settings/data");
  });
});
