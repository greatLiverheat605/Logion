"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { Button } from "@/platform/workbench/components";
import { errorMessage, workbenchRequest } from "@/platform/workbench/api";
import { useWorkbench } from "@/platform/workbench/provider";

type Status = components["schemas"]["ZoteroSyncStatus"];
const errors: Record<string, string> = {
  ZOTERO_RATE_LIMITED: "Zotero 要求暂缓请求，将在允许的时间继续。",
  ZOTERO_RESPONSE_INVALID: "Zotero 数据格式异常，未推进同步游标。",
  ZOTERO_SYNC_ACCESS_REVOKED: "当前账户已无法向这个空间同步。",
  INTEGRATION_AUTH_FAILED: "Zotero 凭据已失效，请重新配置并测试连接。",
  ZOTERO_IDENTIFIER_CONFLICT: "多个已有文献的标识符冲突，请先在文献库核对。",
  RESOURCE_QUOTA_EXCEEDED: "文献数量已达到上限，请整理后再次同步。",
};

export function ZoteroSync() {
  const { context, spaces } = useWorkbench();
  const client = useQueryClient();
  const path = context
    ? `/api/v1/workspaces/${context.workspace_id}/spaces/${context.space_id}/zotero-sync`
    : "";
  const queryKey = [
    "workbench",
    "zotero-sync",
    context?.workspace_id,
    context?.space_id,
  ];
  const status = useQuery({
    queryKey,
    enabled: Boolean(context),
    queryFn: () => workbenchRequest<Status>(path),
    refetchInterval: (query) => (query.state.data?.pending ? 2000 : false),
  });
  const trigger = useMutation({
    mutationFn: () => workbenchRequest<Status>(path, { method: "POST" }),
    onSuccess: (data) => client.setQueryData(queryKey, data),
  });
  if (!context) return null;
  const space = spaces.find((item) => item.id === context.space_id);
  return (
    <section className="wb-integration" aria-label="Zotero 文献同步">
      <h3>同步文献</h3>
      <p>
        同步到当前空间“{space?.name ?? "已选空间"}
        ”，文献仍仅自己可见。首次手动同步后，每 30 分钟自动更新。
      </p>
      <Button
        disabled={
          !status.data?.configured || trigger.isPending || status.data?.pending
        }
        onClick={() => trigger.mutate()}
      >
        立即同步 Zotero
      </Button>
      <p role="status">
        {status.data?.pending
          ? "正在同步…"
          : status.data?.last_sync_at
            ? `最近同步：${new Date(status.data.last_sync_at).toLocaleString("zh-CN")}`
            : "尚未同步。请先保存并测试 Zotero 连接。"}
      </p>
      {status.data?.retry_after &&
        new Date(status.data.retry_after) > new Date() && (
          <p>
            服务暂缓请求，最早继续时间：
            {new Date(status.data.retry_after).toLocaleString("zh-CN")}
          </p>
        )}
      {status.data?.last_error_code && (
        <p role="alert">
          {errors[status.data.last_error_code] ??
            "同步未完成，请检查连接后再次尝试。"}
        </p>
      )}
      {(status.error || trigger.error) && (
        <p role="alert">{errorMessage(status.error || trigger.error)}</p>
      )}
    </section>
  );
}
