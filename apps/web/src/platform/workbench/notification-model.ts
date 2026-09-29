import type { components } from "@logion/contracts";

export type Notification = components["schemas"]["NotificationResponse"];

// These are the existing server producers. Unknown events remain visible in
// history, but do not invent an action or inflate the action-only unread badge.
export function notificationPresentation(row: Notification) {
  const base = {
    title: row.title,
    summary: row.summary,
    action: false,
    href: "",
  };
  if (row.category === "security")
    return { ...base, action: true, href: "/settings/security" };
  if (row.category === "learning" && row.target_type === "review")
    return { ...base, action: true, href: "/review" };
  if (row.category === "ai" && row.target_type === "ai_run")
    return {
      ...base,
      action: true,
      title: "AI 草稿已就绪",
      summary:
        "请回到发起任务的阅读器、知识网或周计划查看。草稿仍需本人核实与确认。",
    };
  if (row.category === "system" && row.target_type === "data_export")
    return {
      ...base,
      action: true,
      title: "数据导出已就绪",
      summary: "请在生成后 24 小时内到数据导出页下载。",
      href: "/settings/data",
    };
  if (row.category === "collaboration" && row.target_type === "share_snapshot")
    return {
      ...base,
      title: "只读分享已创建",
      summary: "已创建可撤销的只读快照。",
    };
  if (row.category === "sync" && row.target_type === "sync") {
    const counts =
      /^服务端已接收 \d+ 项；待处理冲突 (\d+) 项；未接收 (\d+) 项；已解决冲突 \d+ 项。$/.exec(
        row.summary,
      );
    const action =
      row.title === "同步推送回执" &&
      counts !== null &&
      (Number(counts[1]) > 0 || Number(counts[2]) > 0);
    return {
      ...base,
      action,
      href: action
        ? `/app/sync?legacy=sync&workspace=${encodeURIComponent(row.workspace_id)}`
        : "",
    };
  }
  return base;
}

export function actionUnreadCount(rows: readonly Notification[]) {
  return rows.filter(
    (row) => row.read_at === null && notificationPresentation(row).action,
  ).length;
}
