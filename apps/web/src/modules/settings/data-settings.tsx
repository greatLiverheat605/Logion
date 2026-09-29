"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@logion/contracts";
import { ExportDownload } from "@/features/data/export-download";
import { LogionApiError } from "@/lib/api/client";
import { useWorkbench } from "@/platform/workbench/provider";
import { workbenchRequest, errorMessage } from "@/platform/workbench/api";
import { Button, Sheet } from "@/platform/workbench/components";
import "./settings.css";

type Export = components["schemas"]["ExportResponse"];
const states: Record<Export["status"], string> = {
  queued: "等待生成",
  running: "正在生成",
  succeeded: "可下载",
  failed: "生成失败",
  cancelled: "已取消",
  expired: "已过期",
};
function message(error: unknown) {
  if (error instanceof LogionApiError) {
    if (error.code === "EXPORT_ALREADY_PENDING")
      return "已有导出正在生成，请等待完成或先取消。";
    if (error.code === "VERSION_CONFLICT")
      return "任务状态已变化，请刷新后重试。";
  }
  return errorMessage(error);
}
export function DataSettings() {
  const { context } = useWorkbench();
  const [format, setFormat] = useState("research");
  return (
    <div className="wb-page wb-config-page">
      <Link href="/settings">返回设置</Link>
      <div className="wb-page-heading">
        <div>
          <h1>数据导出</h1>
          <p>保存当前工作区中本人有权读取的数据。</p>
        </div>
      </div>
      <label className="wb-config-audit-scope">
        导出格式
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="research">v0.3 研究数据</option>
          <option value="legacy">旧版开放格式</option>
        </select>
      </label>
      {context ? (
        <Exports
          key={`${context.workspace_id}/${format}`}
          workspace={context.workspace_id}
          research={format === "research"}
        />
      ) : (
        <p>请先选择工作区。</p>
      )}
    </div>
  );
}
function Exports({
  workspace,
  research,
}: {
  workspace: string;
  research: boolean;
}) {
  const path = `/api/v1/workspaces/${workspace}/${research ? "research/" : ""}data-exports`;
  const key = ["workbench", "data-exports", workspace, research];
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<"create" | Export | null>(
    null,
  );
  const [accepted, setAccepted] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const listing = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      workbenchRequest<components["schemas"]["ExportList"]>(path, { signal }),
    refetchInterval: (query) =>
      query.state.data?.exports.some((row) =>
        ["queued", "running"].includes(row.status),
      )
        ? 2000
        : false,
  });
  const mutation = useMutation({
    mutationFn: (action: "create" | Export) =>
      action === "create"
        ? workbenchRequest<Export>(path, {
            method: "POST",
            body: JSON.stringify({
              id: crypto.randomUUID(),
              confirmation: "EXPORT",
            }),
          })
        : workbenchRequest<Export>(`${path}/${action.id}/cancel`, {
            method: "POST",
            body: JSON.stringify({ expected_version: action.version }),
          }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
      setConfirmation(null);
    },
  });
  const rows = listing.data?.exports ?? [];
  const pending = rows.some((row) =>
    ["queued", "running"].includes(row.status),
  );
  function open(action: "create" | Export) {
    trigger.current = document.activeElement as HTMLElement | null;
    mutation.reset();
    setAccepted(false);
    setConfirmation(action);
  }
  return (
    <>
      <section className="wb-config-section" aria-label="导出内容">
        <h2>{research ? "带走完整的阅读记录" : "保留旧版数据格式"}</h2>
        <p>
          {research
            ? "包含文献、已提取全文、摘录、普通与精读笔记、研究问题、私人想法、知识点、测验与作答、掌握与复习、连线及周回顾。"
            : "沿用旧版格式，包含旧笔记、计划、复习和既有模块数据；私人研究内容请使用 v0.3 格式。"}
        </p>
        <p>
          包括可访问的归档空间，不包括已删除空间。凭据、AI 原始输入和 PDF
          原件不进入导出。
        </p>
        <p>
          文件在服务器上加密保存，有效期为创建后 24 小时。下载得到可直接阅读的
          ZIP，请妥善保管。
        </p>
        {research && (
          <p>
            私人想法仅供本人导出，过程不调用 AI。v0.3 导出目前不提供重新导入。
          </p>
        )}
        <Button
          className="wb-primary"
          onClick={() => open("create")}
          disabled={listing.isPending || listing.isError || pending}
        >
          创建导出
        </Button>
      </section>
      <section className="wb-config-section" aria-label="导出任务">
        <header>
          <h2>导出任务</h2>
          <Button
            ref={refreshButton}
            disabled={listing.isFetching}
            onClick={() => void listing.refetch()}
          >
            刷新状态
          </Button>
        </header>
        {listing.isPending && <p role="status">正在读取导出记录…</p>}
        {listing.error && <p role="alert">{message(listing.error)}</p>}
        {!listing.isPending && !listing.isError && rows.length === 0 && (
          <p>还没有导出记录。</p>
        )}
        {pending && <p role="status">后台正在处理，完成后可在这里下载。</p>}
        <ul className="wb-config-list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="wb-config-break">
                <h3>{states[row.status]}</h3>
                <p>创建于 {new Date(row.created_at).toLocaleString("zh-CN")}</p>
                <p>
                  有效期至 {new Date(row.expires_at).toLocaleString("zh-CN")}
                </p>
                {row.artifact_bytes != null && (
                  <p>文件大小：{(row.artifact_bytes / 1024).toFixed(1)} KB</p>
                )}
                {row.artifact_sha256 && (
                  <details>
                    <summary>校验 SHA-256</summary>
                    <code>{row.artifact_sha256}</code>
                  </details>
                )}
                {row.error_code && (
                  <p role="alert">
                    生成失败，请确认空间访问权限后重新创建。错误代码：
                    {row.error_code}
                  </p>
                )}
              </div>
              {row.status === "succeeded" && (
                <ExportDownload
                  item={row}
                  research={research}
                  className="wb-button"
                />
              )}
              {["queued", "running"].includes(row.status) && (
                <Button onClick={() => open(row)}>取消导出</Button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Sheet
        title={confirmation === "create" ? "确认创建导出" : "取消导出任务"}
        description={
          confirmation === "create"
            ? "导出仅供本人下载，需要最近登录验证。"
            : "取消后不会提供该任务的下载文件，原始数据保留。"
        }
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmation(null);
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (trigger.current?.isConnected
            ? trigger.current
            : refreshButton.current
          )?.focus();
        }}
      >
        <div className="wb-config-form">
          {confirmation === "create" && (
            <label className="wb-config-check">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {research
                ? "我了解导出包含私人想法，并会妥善保管下载文件。"
                : "我会妥善保管下载文件。"}
            </label>
          )}
          {mutation.error && <p role="alert">{message(mutation.error)}</p>}
          <div className="wb-config-actions">
            <Button
              ref={cancelButton}
              disabled={mutation.isPending}
              onClick={() => setConfirmation(null)}
            >
              返回
            </Button>
            <Button
              className="wb-primary"
              disabled={
                mutation.isPending || (confirmation === "create" && !accepted)
              }
              onClick={() => confirmation && mutation.mutate(confirmation)}
            >
              {mutation.isPending
                ? "正在提交…"
                : confirmation === "create"
                  ? "确认创建"
                  : "确认取消任务"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
