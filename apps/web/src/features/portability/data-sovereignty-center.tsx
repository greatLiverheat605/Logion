"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type DataExport = components["schemas"]["ExportResponse"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError)
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  return "操作未完成，请稍后重试。";
}

export function DataSovereigntyCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [exports, setExports] = useState<DataExport[]>([]);
  const [dataWorkspaceId, setDataWorkspaceId] = useState("");
  const [status, setStatus] = useState(
    "导出在服务器后台生成并加密保存，24 小时后失效。",
  );

  const loadWorkspaces = useCallback(async () => {
    try {
      const result = await browserApiClient.request<{
        workspaces: Workspace[];
      }>("/api/v1/workspaces");
      const next = Array.isArray(result.workspaces) ? result.workspaces : [];
      setWorkspaces(next);
      setWorkspaceId((current) =>
        next.some((item) => item.id === current)
          ? current
          : (next[0]?.id ?? ""),
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }, []);

  const loadExports = useCallback(async (selected: string) => {
    try {
      const result = await browserApiClient.request<{
        exports: DataExport[];
      }>(`/api/v1/workspaces/${selected}/data-exports`);
      setExports(Array.isArray(result.exports) ? result.exports : []);
      setDataWorkspaceId(selected);
    } catch (error) {
      setExports([]);
      setDataWorkspaceId(selected);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadExports(workspaceId));
  }, [loadExports, workspaceId]);

  async function createExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const confirmation = String(
      new FormData(event.currentTarget).get("confirmation") ?? "",
    );
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/data-exports`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ id: crypto.randomUUID(), confirmation }),
        },
      );
      event.currentTarget.reset();
      await loadExports(workspaceId);
      setStatus("导出已进入后台队列；完成后会出现在列表中并发送站内通知。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function cancelExport(item: DataExport) {
    if (!workspaceId) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/data-exports/${item.id}/cancel`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ expected_version: item.version }),
        },
      );
      await loadExports(workspaceId);
      setStatus("导出任务已取消，未完成的产物不会保留。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  const visibleExports = dataWorkspaceId === workspaceId ? exports : [];

  return (
    <main id="main-content" className="settings-page">
      <header>
        <p className="eyebrow">LOGION · DATA SOVEREIGNTY</p>
        <h1>数据导出、迁移与删除</h1>
        <p aria-live="polite">{status}</p>
      </header>
      <section className="settings-card">
        <label htmlFor="data-workspace">工作区</label>
        <select
          id="data-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name} · {workspace.role}
            </option>
          ))}
        </select>
      </section>
      <section className="settings-card">
        <h2>可独立阅读的数据包</h2>
        <p>
          ZIP 包含版本化 JSON、笔记 Markdown、任务 CSV 与论文
          BibTeX；不包含登录凭据、恢复材料、AI 密钥、AI 输入或分享/日历令牌。
        </p>
        <form className="planning-form" onSubmit={createExport}>
          <label>
            输入 EXPORT 确认创建
            <input name="confirmation" pattern="EXPORT" required />
          </label>
          <button>创建加密导出</button>
        </form>
        <ul className="item-list">
          {visibleExports.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.status}</strong>
                <small>
                  {item.schema_version} · {item.artifact_bytes ?? 0} bytes ·
                  版本 {item.version}
                </small>
                {item.artifact_sha256 ? (
                  <code>{item.artifact_sha256}</code>
                ) : null}
              </span>
              {item.status === "succeeded" ? (
                <a
                  className="text-link"
                  href={`/api/v1/workspaces/${workspaceId}/data-exports/${item.id}/download`}
                >
                  下载
                </a>
              ) : null}
              {item.status === "queued" || item.status === "running" ? (
                <button type="button" onClick={() => void cancelExport(item)}>
                  取消
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="settings-card">
        <h2>迁移与删除</h2>
        <p>
          导入预览、账户删除生命周期与工作区备份恢复将在本阶段后续工作包中启用。
        </p>
      </section>
    </main>
  );
}
