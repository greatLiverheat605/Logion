"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useWorkbench } from "./provider";
import { workbenchRequest } from "./api";
import { actionUnreadCount, type Notification } from "./notification-model";

export type NotificationList = { notifications: Notification[] };

export function useNotifications() {
  const { context, preferences, workspaces } = useWorkbench();
  const preferred =
    context?.workspace_id ?? preferences["workbench.context"]?.workspace_id;
  const workspace =
    workspaces.find((row) => row.id === preferred) ?? workspaces[0];
  const workspaceId = workspace?.id ?? "";
  const queryKey = ["workbench", "notifications", workspaceId] as const;
  const path = `/api/v1/workspaces/${workspaceId}/notifications`;
  const query = useQuery({
    queryKey,
    enabled: Boolean(workspaceId),
    queryFn: ({ signal }) =>
      workbenchRequest<NotificationList>(path, { signal }),
    refetchOnWindowFocus: false,
  });
  return { workspace, query, rows: query.data?.notifications ?? [] };
}

export function NotificationEntry() {
  const { workspace, query, rows } = useNotifications();
  const count = actionUnreadCount(rows);
  const label = query.error
    ? "通知，读取失败，请打开后重试"
    : query.isPending
      ? "通知，正在读取"
      : `通知，${count} 条待处理未读`;
  if (!workspace) return null;
  return (
    <Link
      href="/settings/notifications"
      className="wb-button wb-notification-entry"
      aria-label={label}
    >
      通知
      {!query.error && !query.isPending && count > 0 && (
        <span className="wb-notification-count" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </span>
      )}
      {query.error && <span aria-hidden="true"> !</span>}
    </Link>
  );
}
