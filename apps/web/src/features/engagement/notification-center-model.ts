import type { components } from "@logion/contracts";

type Notification = components["schemas"]["NotificationResponse"];

export const NOTIFICATION_CATEGORIES = [
  "learning",
  "collaboration",
  "sync",
  "security",
  "ai",
  "system",
] as const;

export const NOTIFICATION_CENTER_UPDATED_EVENT =
  "logion:notification-center-updated";

export function visibleNotifications(
  notifications: readonly Notification[],
): Notification[] {
  const seen = new Set<string>();
  return notifications.filter((notification) => {
    const key = `${notification.workspace_id}:${notification.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return NOTIFICATION_CATEGORIES.includes(
      notification.category as (typeof NOTIFICATION_CATEGORIES)[number],
    );
  });
}

export type NotificationGroup = Notification & {
  members: Notification[];
  unreadCount: number;
};

function ordinaryReceipt(notification: Notification): "push" | "pull" | null {
  if (notification.category !== "sync" || notification.target_type !== "sync")
    return null;
  if (
    notification.title === "同步推送回执" &&
    /^服务端已接收 [1-9]\d* 项；待处理冲突 0 项；未接收 0 项；已解决冲突 0 项。$/.test(
      notification.summary,
    )
  )
    return "push";
  if (
    notification.title === "同步拉取回执" &&
    /^服务端返回 [1-9]\d* 条变更；设备应用结果请查看同步中心。$/.test(
      notification.summary,
    )
  )
    return "pull";
  return null;
}

// Presentation only: the API exposes neither a synchronization round nor history pagination.
export function groupNotifications(
  notifications: readonly Notification[],
): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const notification of visibleNotifications(notifications)) {
    const receipt = ordinaryReceipt(notification);
    const key = receipt
      ? `${notification.workspace_id}:ordinary-${receipt}`
      : `${notification.workspace_id}:${notification.id}`;
    const group = groups.get(key);
    if (group) {
      group.members.push(notification);
      group.unreadCount += notification.read_at === null ? 1 : 0;
      group.title = `普通${notification.title}`;
      group.summary = `${group.members.length} 条服务端回执；设备应用结果请查看同步中心。`;
      if (notification.read_at === null) group.read_at = null;
    } else {
      groups.set(key, {
        ...notification,
        id: key,
        members: [notification],
        unreadCount: notification.read_at === null ? 1 : 0,
      });
    }
  }
  return [...groups.values()];
}

export function notificationSummary(notifications: readonly Notification[]) {
  const visible = visibleNotifications(notifications);
  return {
    latest: groupNotifications(visible).slice(0, 3),
    total: visible.length,
    unread: visible.filter((notification) => notification.read_at === null)
      .length,
  };
}

export function announceNotificationWorkspace(
  workspaceId: string,
  userId: string,
) {
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_CENTER_UPDATED_EVENT, {
      detail: { workspaceId, userId },
    }),
  );
}
