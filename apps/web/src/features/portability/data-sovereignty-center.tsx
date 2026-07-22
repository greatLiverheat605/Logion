"use client";

import type { components } from "@logion/contracts";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { browserApiClient, LogionApiError } from "@/lib/api/client";

type Workspace = components["schemas"]["WorkspaceResponse"];
type DataExport = components["schemas"]["ExportResponse"];
type DataImport = components["schemas"]["ImportPreviewResponse"];
type Space = components["schemas"]["SpaceResponse"];

function errorText(error: unknown) {
  if (error instanceof LogionApiError)
    return `操作未完成（${error.code}，请求编号：${error.requestId}）。`;
  return "操作未完成，请稍后重试。";
}

export function DataSovereigntyCenter() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [exports, setExports] = useState<DataExport[]>([]);
  const [imports, setImports] = useState<DataImport[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [targetSpaceId, setTargetSpaceId] = useState("");
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

  const loadData = useCallback(async (selected: string) => {
    try {
      const [exportResult, importResult, spaceResult] = await Promise.all([
        browserApiClient.request<{ exports: DataExport[] }>(
          `/api/v1/workspaces/${selected}/data-exports`,
        ),
        browserApiClient.request<{ imports: DataImport[] }>(
          `/api/v1/workspaces/${selected}/data-imports`,
        ),
        browserApiClient.request<{ spaces: Space[] }>(
          `/api/v1/workspaces/${selected}/spaces`,
        ),
      ]);
      const nextSpaces = Array.isArray(spaceResult.spaces)
        ? spaceResult.spaces.filter((space) => space.visibility === "private")
        : [];
      setExports(
        Array.isArray(exportResult.exports) ? exportResult.exports : [],
      );
      setImports(
        Array.isArray(importResult.imports) ? importResult.imports : [],
      );
      setSpaces(nextSpaces);
      setTargetSpaceId((current) =>
        nextSpaces.some((space) => space.id === current)
          ? current
          : (nextSpaces[0]?.id ?? ""),
      );
      setDataWorkspaceId(selected);
    } catch (error) {
      setExports([]);
      setImports([]);
      setSpaces([]);
      setDataWorkspaceId(selected);
      setStatus(errorText(error));
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadWorkspaces());
  }, [loadWorkspaces]);

  useEffect(() => {
    if (workspaceId) queueMicrotask(() => void loadData(workspaceId));
  }, [loadData, workspaceId]);

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
      await loadData(workspaceId);
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
      await loadData(workspaceId);
      setStatus("导出任务已取消，未完成的产物不会保留。");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const data = new FormData(event.currentTarget);
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/data-imports/preview`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            id: crypto.randomUUID(),
            source_format: String(data.get("source_format") ?? "markdown"),
            source_filename: String(data.get("source_filename") ?? "import.md"),
            content: String(data.get("content") ?? ""),
          }),
        },
      );
      event.currentTarget.reset();
      await loadData(workspaceId);
      setStatus(
        "导入源已安全解析；检查计数和警告后，再确认写入自己的私有 Space。",
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function commitImport(item: DataImport) {
    if (!workspaceId || !targetSpaceId) return;
    try {
      await browserApiClient.request(
        `/api/v1/workspaces/${workspaceId}/data-imports/${item.id}/commit`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({
            target_space_id: targetSpaceId,
            expected_version: item.version,
            confirmation: "IMPORT",
          }),
        },
      );
      await loadData(workspaceId);
      setStatus(
        "导入已在单个事务中完成；所有对象均使用新 ID。原权限和原 ID 未被恢复。",
      );
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  async function requestAccountDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmation = String(
      new FormData(event.currentTarget).get("deletion_confirmation") ?? "",
    );
    try {
      await browserApiClient.request("/api/v1/account-deletion", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ confirmation }),
      });
      window.location.assign("/auth/login");
    } catch (error) {
      setStatus(errorText(error));
    }
  }

  const visibleExports = dataWorkspaceId === workspaceId ? exports : [];
  const visibleImports = dataWorkspaceId === workspaceId ? imports : [];

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
        <h2>预览后导入</h2>
        <p>
          支持 Logion export v1 JSON、Markdown、带 title 列的 CSV 和保守解析的
          BibTeX。解析过程不执行脚本、不访问链接，也不会恢复原权限或原始 ID。
        </p>
        <form className="planning-form" onSubmit={previewImport}>
          <label>
            格式
            <select name="source_format" defaultValue="markdown">
              <option value="logion_json">Logion JSON</option>
              <option value="markdown">Markdown</option>
              <option value="csv">CSV</option>
              <option value="bibtex">BibTeX</option>
            </select>
          </label>
          <label>
            文件名
            <input
              name="source_filename"
              defaultValue="import.md"
              maxLength={255}
              required
            />
          </label>
          <label>
            内容（最多 1 MiB）
            <textarea name="content" maxLength={1_048_576} required />
          </label>
          <button>生成加密预览</button>
        </form>
        <label htmlFor="import-target-space">写入自己的私有 Space</label>
        <select
          id="import-target-space"
          value={targetSpaceId}
          onChange={(event) => setTargetSpaceId(event.target.value)}
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
        <ul className="item-list">
          {visibleImports.map((item) => (
            <li key={item.id}>
              <span>
                <strong>
                  {item.source_filename} · {item.status}
                </strong>
                <small>{JSON.stringify(item.counts)}</small>
                {item.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </span>
              {item.status === "previewed" ? (
                <button
                  type="button"
                  disabled={!targetSpaceId}
                  onClick={() => void commitImport(item)}
                >
                  确认 IMPORT
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
      <section className="settings-card">
        <h2>删除账户</h2>
        <p>
          删除请求会立即撤销会话、分享和日历订阅。若你仍拥有有其他成员的工作区，必须先转移所有权。
          宽限期内可重新登录并在受限恢复页取消；到期后清理个人数据并去标识化最小审计记录。
        </p>
        <form className="planning-form" onSubmit={requestAccountDeletion}>
          <label>
            输入 DELETE MY ACCOUNT
            <input
              name="deletion_confirmation"
              pattern="DELETE MY ACCOUNT"
              autoComplete="off"
              required
            />
          </label>
          <button className="danger-button">请求删除账户</button>
        </form>
      </section>
    </main>
  );
}
