"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { useWorkbench } from "@/platform/workbench/provider";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button } from "@/platform/workbench/components";
import "./settings.css";

const actionLabels: Record<string, string> = {
  "identity.login_succeeded": "登录",
  "identity.logout": "退出登录",
  "identity.device_revoked": "撤销设备",
  "identity.device_auto_revoked": "撤销长期未使用的设备",
  "identity.other_sessions_revoked": "退出其他会话",
  "ai.provider_created": "添加 AI 服务商",
  "ai.provider_updated": "更新 AI 服务商",
  "ai.provider_deleted": "删除 AI 服务商",
  "ai.provider_models_discovered": "发现模型",
  "ai.model_created": "添加模型",
  "ai.model_updated": "更新模型",
  "ai.route_created": "创建任务路由",
  "ai.route_updated": "更新任务路由",
  "ai.route_deleted": "删除任务路由",
};
export function AuditSettings() {
  const { context, workspaces } = useWorkbench();
  const workspace = workspaces.find((w) => w.id === context?.workspace_id);
  return (
    <div className="wb-page wb-config-page">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>审计记录</h1>
          <p>查看账户安全操作和有权管理的工作区事件。</p>
        </div>
      </div>
      <AuditScope
        key={workspace?.id ?? "personal"}
        workspaceId={
          workspace && ["owner", "admin"].includes(workspace.role)
            ? workspace.id
            : undefined
        }
      />
    </div>
  );
}
function AuditScope({ workspaceId }: { workspaceId?: string }) {
  const [scope, setScope] = useState("personal");
  const [filter, setFilter] = useState({ event_type: "", result: "" });
  const path =
    scope === "workspace" && workspaceId
      ? `/api/v1/workspaces/${workspaceId}/audit-events`
      : "/api/v1/audit/me";
  const events = useInfiniteQuery({
    queryKey: ["workbench", "audit", path, filter],
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      workbenchRequest<components["schemas"]["AuditEventPageResponse"]>(path, {
        signal,
        query: {
          page_size: "50",
          ...(pageParam ? { cursor: pageParam } : {}),
          ...(filter.event_type ? { event_type: filter.event_type } : {}),
          ...(filter.result ? { result: filter.result } : {}),
        },
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  return (
    <section className="wb-config-section" aria-label="审计事件">
      <label className="wb-config-audit-scope">
        审计范围
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="personal">我的账户安全</option>
          {workspaceId && <option value="workspace">当前工作区</option>}
        </select>
      </label>
      <form
        className="wb-config-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setFilter({
            event_type: String(values.get("event_type") ?? ""),
            result: String(values.get("result") ?? ""),
          });
        }}
      >
        <label>
          操作代码（可留空）
          <input
            name="event_type"
            maxLength={80}
            pattern="[a-z0-9_.]+"
            placeholder="例如 ai.provider_created"
          />
        </label>
        <label>
          结果
          <select name="result">
            <option value="">全部结果</option>
            <option value="success">成功</option>
            <option value="denied">拒绝</option>
            <option value="failure">失败</option>
          </select>
        </label>
        <Button type="submit">应用筛选</Button>
        <Button
          onClick={() => void events.refetch()}
          disabled={events.isFetching}
        >
          刷新记录
        </Button>
      </form>
      {events.isPending && <p role="status">正在读取审计记录…</p>}
      {events.error && <p role="alert">{errorMessage(events.error)}</p>}
      {events.data?.pages[0]?.events.length === 0 && (
        <p>没有符合条件的审计记录。</p>
      )}
      <ol className="wb-config-audit-list">
        {events.data?.pages
          .flatMap((p) => p.events)
          .map((event) => (
            <li key={event.id}>
              <div>
                <strong>{actionLabels[event.event_type] ?? "操作事件"}</strong>
                <span>
                  {event.result === "success"
                    ? "成功"
                    : event.result === "denied"
                      ? "拒绝"
                      : event.result === "failure"
                        ? "失败"
                        : event.result}
                </span>
              </div>
              <p className="wb-config-break">操作代码：{event.event_type}</p>
              <time dateTime={event.occurred_at}>
                {new Date(event.occurred_at).toLocaleString()}
              </time>
              <details>
                <summary>事件详情</summary>
                <dl>
                  <dt>对象类型</dt>
                  <dd>{event.target_type}</dd>
                  <dt>对象编号</dt>
                  <dd>{event.target_id ?? "无"}</dd>
                  <dt>操作者编号</dt>
                  <dd>{event.actor_id ?? "系统"}</dd>
                  <dt>事件编号</dt>
                  <dd>{event.id}</dd>
                </dl>
              </details>
            </li>
          ))}
      </ol>
      {events.hasNextPage && (
        <Button
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          加载更多记录
        </Button>
      )}
    </section>
  );
}
