"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/platform/workbench/components";
import { errorMessage, workbenchRequest } from "@/platform/workbench/api";
import {
  useNotifications,
  type NotificationList,
} from "@/platform/workbench/notifications";
import {
  actionUnreadCount,
  notificationPresentation,
  type Notification,
} from "@/platform/workbench/notification-model";
import "./settings.css";

export function NotificationSettings() {
  const { workspace } = useNotifications();
  return (
    <div className="wb-page wb-config-page wb-notification-settings">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>通知</h1>
          <p>只有需要查看或处理的事项计入未读，常规保存保持安静。</p>
        </div>
      </div>
      {workspace ? (
        <NotificationHistory key={workspace.id} />
      ) : (
        <p>当前没有可访问的工作区。</p>
      )}
    </div>
  );
}

function NotificationHistory() {
  const { workspace, query, rows } = useNotifications();
  const client = useQueryClient();
  const read = useMutation({
    mutationFn: (id: string) =>
      workbenchRequest<Notification>(
        `/api/v1/workspaces/${workspace!.id}/notifications/${id}/read`,
        {
          method: "POST",
          body: JSON.stringify({ read: true }),
        },
      ),
    onSuccess: async (updated) => {
      // A refresh started before this write must not overwrite its acknowledgement.
      await client.cancelQueries({
        queryKey: ["workbench", "notifications", updated.workspace_id],
        exact: true,
      });
      client.setQueryData<NotificationList>(
        ["workbench", "notifications", updated.workspace_id],
        (old) =>
          old
            ? {
                notifications: old.notifications.map((row) =>
                  row.id === updated.id ? updated : row,
                ),
              }
            : old,
      );
    },
  });
  return (
    <section className="wb-config-section" aria-label="通知历史">
      <header>
        <h2>
          {workspace?.name === "Personal workspace"
            ? "个人工作区"
            : workspace?.name}
        </h2>
        <Button
          disabled={query.isFetching || read.isPending}
          onClick={() => void query.refetch()}
        >
          刷新通知
        </Button>
      </header>
      <p>
        显示当前工作区最近 200
        条通知。普通同步成功回执保留在历史中，不计入未读。
      </p>
      <p>标为已读仅表示你已查看，不会接受 AI 草稿、确认掌握或解决同步冲突。</p>
      {query.isPending && <p role="status">正在读取通知…</p>}
      {query.error && (
        <p role="alert">
          {errorMessage(query.error)} 已显示的记录保留，请刷新重试。
        </p>
      )}
      {read.error && (
        <p role="alert">{errorMessage(read.error)} 通知尚未标为已读。</p>
      )}
      {query.data && (
        <p role="status" aria-atomic="true">
          {actionUnreadCount(rows)} 条待处理未读通知
        </p>
      )}
      {query.data && rows.length === 0 && <p>还没有通知。</p>}
      <ol className="wb-config-list">
        {rows.map((row) => {
          const view = notificationPresentation(row);
          return (
            <li key={row.id}>
              <div className="wb-config-break">
                <strong>{view.title}</strong>
                <p>{view.summary}</p>
                <p>
                  {view.action
                    ? row.read_at
                      ? "已读"
                      : "待查看或处理"
                    : "历史记录 · 不计入未读"}
                </p>
                <time dateTime={row.created_at}>
                  {new Date(row.created_at).toLocaleString()}
                </time>
                {view.href && (
                  <p>
                    <Link href={view.href}>前往处理</Link>
                  </p>
                )}
              </div>
              <Button
                disabled={Boolean(row.read_at) || read.isPending}
                onClick={() => read.mutate(row.id)}
              >
                {read.isPending && read.variables === row.id
                  ? "正在标记…"
                  : row.read_at
                    ? "已读"
                    : "标为已读"}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
