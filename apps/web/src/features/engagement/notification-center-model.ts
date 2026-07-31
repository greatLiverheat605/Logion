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
  return notifications.filter((notification) =>
    NOTIFICATION_CATEGORIES.includes(
      notification.category as (typeof NOTIFICATION_CATEGORIES)[number],
    ),
  );
}

export function notificationSummary(notifications: readonly Notification[]) {
  const visible = visibleNotifications(notifications);
  return {
    latest: visible.slice(0, 3),
    total: visible.length,
    unread: visible.filter((notification) => notification.read_at === null)
      .length,
  };
}

export function announceNotificationWorkspace(workspaceId: string) {
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_CENTER_UPDATED_EVENT, {
      detail: workspaceId,
    }),
  );
}
