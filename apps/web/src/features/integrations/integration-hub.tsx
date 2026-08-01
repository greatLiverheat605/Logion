"use client";

import Link from "next/link";
import { secureRandomUuid } from "@logion/offline";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  ProductEmptyState,
  ProductHero,
  ProductMetric,
  ProductPageHeader,
  ProductPanel,
  ProductTag,
} from "@/components/product/product-ui";
import {
  integrationCapabilityService,
  type IntegrationCapabilityService,
} from "@/features/integrations/integration-capability-service";

import {
  integrationCapabilityErrorState,
  summarizeIntegrationCapabilities,
  type IntegrationCapabilityData,
  type IntegrationCapabilityErrorState,
  type Workspace,
} from "./integration-capability-model";

type HubPhase = "empty" | "error" | "loading" | "needs-context" | "ready";
type HubService = Pick<
  IntegrationCapabilityService,
  | "listCalendarFeeds"
  | "listWorkspaces"
  | "loadPortability"
  | "cancelExport"
  | "commitImport"
  | "createCalendarFeed"
  | "createExport"
  | "previewImport"
  | "revokeCalendarFeed"
>;

const EMPTY_DATA: IntegrationCapabilityData = {
  exports: [],
  feeds: [],
  imports: [],
  privateSpaces: [],
};

function hasActivity(data: IntegrationCapabilityData): boolean {
  return Boolean(
    data.feeds.length || data.exports.length || data.imports.length,
  );
}

export function IntegrationHub({
  service = integrationCapabilityService,
}: Readonly<{ service?: HubService }>) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [contextPhase, setContextPhase] = useState<
    "error" | "loading" | "ready"
  >("loading");
  const [dataPhase, setDataPhase] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const [data, setData] = useState<IntegrationCapabilityData>(EMPTY_DATA);
  const [error, setError] = useState<IntegrationCapabilityErrorState | null>(
    null,
  );
  const [contextReload, setContextReload] = useState(0);
  const [dataReload, setDataReload] = useState(0);
  const [calendarToken, setCalendarToken] = useState("");
  const [targetSpaceId, setTargetSpaceId] = useState("");
  const [actionStatus, setActionStatus] =
    useState("选择工作区后可管理当前已有能力。");

  useEffect(() => {
    let active = true;
    void service
      .listWorkspaces()
      .then((next) => {
        if (!active) return;
        setWorkspaces(next);
        setWorkspaceId((current) =>
          next.some((workspace) => workspace.id === current)
            ? current
            : (next[0]?.id ?? ""),
        );
        setContextPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setWorkspaces([]);
        setWorkspaceId("");
        setData(EMPTY_DATA);
        setDataPhase("idle");
        setError(integrationCapabilityErrorState(reason));
        setContextPhase("error");
      });
    return () => {
      active = false;
    };
  }, [contextReload, service]);

  useEffect(() => {
    if (!workspaceId || contextPhase !== "ready") return;
    let active = true;
    void Promise.all([
      service.listCalendarFeeds(workspaceId),
      service.loadPortability(workspaceId),
    ])
      .then(([feeds, portability]) => {
        if (!active) return;
        setData({ feeds, ...portability });
        setTargetSpaceId((current) =>
          portability.privateSpaces.some((space) => space.id === current)
            ? current
            : (portability.privateSpaces[0]?.id ?? ""),
        );
        setDataPhase("ready");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setData(EMPTY_DATA);
        setError(integrationCapabilityErrorState(reason));
        setDataPhase("error");
      });
    return () => {
      active = false;
    };
  }, [contextPhase, dataReload, service, workspaceId]);

  const phase: HubPhase =
    contextPhase === "loading"
      ? "loading"
      : contextPhase === "error"
        ? "error"
        : workspaces.length === 0
          ? "needs-context"
          : dataPhase === "error"
            ? "error"
            : dataPhase !== "ready"
              ? "loading"
              : hasActivity(data)
                ? "ready"
                : "empty";
  const summary = useMemo(() => summarizeIntegrationCapabilities(data), [data]);
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );

  function retry() {
    setError(null);
    setData(EMPTY_DATA);
    if (contextPhase === "error") {
      setContextPhase("loading");
      setDataPhase("idle");
      setContextReload((value) => value + 1);
    } else {
      setDataPhase("loading");
      setDataReload((value) => value + 1);
    }
  }

  function selectWorkspace(nextWorkspaceId: string) {
    setData(EMPTY_DATA);
    setDataPhase("loading");
    setError(null);
    setCalendarToken("");
    setTargetSpaceId("");
    setWorkspaceId(nextWorkspaceId);
  }

  function refreshData() {
    setData(EMPTY_DATA);
    setDataPhase("loading");
    setDataReload((value) => value + 1);
  }

  function reportActionError(reason: unknown) {
    const next = integrationCapabilityErrorState(reason);
    setError(next);
    setActionStatus(
      next.kind === "recent-auth-required"
        ? "需要重新登录后才能创建数据导出。"
        : `操作未完成（${next.code}，请求编号：${next.requestId}）。`,
    );
  }

  async function createFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    try {
      const result = await service.createCalendarFeed(workspaceId, {
        id: secureRandomUuid(),
        name: String(new FormData(event.currentTarget).get("name") ?? ""),
      });
      setCalendarToken(result.token);
      event.currentTarget.reset();
      setError(null);
      setActionStatus("日历订阅已创建；请立即保存一次性 URL。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function revokeFeed(feedId: string, version: number) {
    if (!workspaceId) return;
    try {
      await service.revokeCalendarFeed(workspaceId, feedId, version);
      setError(null);
      setActionStatus("日历订阅已撤销，旧 URL 已立即失效。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function createExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const confirmation = String(
      new FormData(event.currentTarget).get("confirmation") ?? "",
    );
    try {
      await service.createExport(workspaceId, {
        confirmation,
        id: secureRandomUuid(),
      });
      event.currentTarget.reset();
      setError(null);
      setActionStatus("导出任务已进入后台队列。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function cancelExport(exportId: string, version: number) {
    if (!workspaceId) return;
    try {
      await service.cancelExport(workspaceId, exportId, version);
      setError(null);
      setActionStatus("导出任务已取消。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function previewImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    const form = new FormData(event.currentTarget);
    try {
      await service.previewImport(workspaceId, {
        content: String(form.get("content") ?? ""),
        id: secureRandomUuid(),
        source_filename: String(form.get("source_filename") ?? "import.md"),
        source_format: String(
          form.get("source_format") ?? "markdown",
        ) as IntegrationCapabilityData["imports"][number]["source_format"],
      });
      event.currentTarget.reset();
      setError(null);
      setActionStatus("导入内容已安全解析；确认计数和警告后再提交。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  async function commitImport(importId: string, version: number) {
    if (!workspaceId || !targetSpaceId) return;
    try {
      await service.commitImport(workspaceId, importId, {
        expected_version: version,
        target_space_id: targetSpaceId,
      });
      setError(null);
      setActionStatus("导入已提交到自己的 Private Space，并使用新的对象 ID。");
      refreshData();
    } catch (reason) {
      reportActionError(reason);
    }
  }

  return (
    <main className="settings-page" id="main-content">
      <ProductPageHeader
        eyebrow="INTEROPERABILITY · OPEN FORMATS"
        title="把已有数据能力连接起来，而不扩大权限边界"
        description={
          <>
            <p>
              当前版本支持开放格式迁移与只读日历
              Feed；第三方账号连接、凭据和自动化规则尚未开放。
            </p>
            {error ? (
              <p className="product-page-status" role="alert">
                {error.kind === "recent-auth-required"
                  ? "此操作需要重新登录后继续。"
                  : `读取未完成（${error.code}）。`}{" "}
                请求编号：{error.requestId}
              </p>
            ) : null}
            <p className="product-page-status" aria-live="polite">
              {actionStatus}
            </p>
          </>
        }
        actions={
          phase === "error" ? (
            <button type="button" onClick={retry}>
              重新读取
            </button>
          ) : null
        }
      />

      <ProductHero
        badge={<ProductTag tone="good">真实 API 状态</ProductTag>}
        title="开放迁移、可撤销订阅、明确的不支持边界"
      >
        所有数字都来自当前工作区；本页不会读取浏览器凭据，也不会保存 Calendar
        Token。
      </ProductHero>

      {phase === "loading" ? (
        <ProductEmptyState
          description="正在读取可访问工作区、日历订阅与数据迁移任务。"
          icon="⌁"
          title="正在准备互操作状态"
        />
      ) : null}
      {phase === "needs-context" ? (
        <ProductEmptyState
          description="获得工作区访问权限后即可读取真实的迁移与日历状态。"
          icon="□"
          title="尚无可访问工作区"
        />
      ) : null}
      {phase === "error" ? (
        <ProductEmptyState
          action={
            <button type="button" onClick={retry}>
              重新读取
            </button>
          }
          description="读取失败不会被显示成空数据；可使用请求编号排查。"
          icon="?"
          title="互操作状态暂时不可用"
        />
      ) : null}

      {contextPhase === "ready" && workspaces.length ? (
        <ProductPanel
          aside={<ProductTag>{currentWorkspace?.role ?? "未选择"}</ProductTag>}
          description="选择要查看的现有工作区；权限仍由后端 Workspace 与 Space 规则校验。"
          title="数据工作区"
        >
          <label htmlFor="integration-workspace">工作区</label>
          <select
            id="integration-workspace"
            value={workspaceId}
            onChange={(event) => selectWorkspace(event.target.value)}
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name} · {workspace.role}
              </option>
            ))}
          </select>
        </ProductPanel>
      ) : null}

      {dataPhase === "ready" ? (
        <>
          {phase === "empty" ? (
            <ProductEmptyState
              description="可以从下方入口创建日历订阅、导入预览或导出任务。"
              icon="+"
              title="当前工作区尚无互操作记录"
            />
          ) : null}
          <div className="product-metric-grid">
            <ProductMetric
              detail={`${summary.calendar.revoked} 个已撤销`}
              label="有效日历 Feed"
              tone="info"
              value={summary.calendar.active}
            />
            <ProductMetric
              detail={`${summary.imports.imported} 个已提交`}
              label="待确认导入"
              tone="warn"
              value={summary.imports.previewed}
            />
            <ProductMetric
              detail={`${summary.exports.total} 个全部任务`}
              label="成功导出"
              tone="good"
              value={summary.exports.succeeded}
            />
            <ProductMetric
              detail="仅可作为导入目标"
              label="自己的 Private Space"
              value={summary.privateSpaces}
            />
          </div>

          <div className="product-dashboard-grid product-dashboard-grid-wide">
            <ProductPanel
              aside={<ProductTag tone="info">只读 ICS</ProductTag>}
              description="Feed 只包含必要标题与时间；撤销后旧地址立即失效。"
              title="Calendar Feed"
            >
              <p>
                {summary.calendar.active} 个有效，{summary.calendar.revoked}{" "}
                个已撤销。 新 Token 只会在创建响应中显示一次。
              </p>
              <form className="planning-form" onSubmit={createFeed}>
                <label>
                  订阅名称
                  <input name="name" maxLength={120} required />
                </label>
                <button>创建日历订阅</button>
              </form>
              {calendarToken ? (
                <div role="status">
                  <strong>一次性 URL</strong>
                  <a
                    className="text-link"
                    href={`/api/v1/calendars/${calendarToken}.ics`}
                    rel="noreferrer"
                  >
                    /api/v1/calendars/{calendarToken}.ics
                  </a>
                  <button type="button" onClick={() => setCalendarToken("")}>
                    关闭一次性 URL
                  </button>
                </div>
              ) : null}
              <ul className="item-list">
                {data.feeds.map((feed) => (
                  <li key={feed.id}>
                    <span>
                      <strong>{feed.name}</strong>
                      <small>{feed.status}</small>
                    </span>
                    {feed.status === "active" ? (
                      <button
                        type="button"
                        onClick={() => void revokeFeed(feed.id, feed.version)}
                      >
                        撤销
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ProductPanel>
            <ProductPanel
              aside={<ProductTag tone="warn">先预览</ProductTag>}
              description="支持 Logion JSON、Markdown、CSV 与 BibTeX。"
              title="开放格式导入"
            >
              <p>
                {summary.imports.previewed} 个待确认，{summary.imports.imported}{" "}
                个已提交； 只允许写入自己的 Private Space。
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
                  内容（最大 1 MiB）
                  <textarea name="content" maxLength={1_048_576} required />
                </label>
                <button>生成导入预览</button>
              </form>
              <label htmlFor="integration-target-space">
                写入自己的 Private Space
              </label>
              <select
                id="integration-target-space"
                value={targetSpaceId}
                onChange={(event) => setTargetSpaceId(event.target.value)}
              >
                {data.privateSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
              <ul className="item-list">
                {data.imports.map((item) => (
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
                        onClick={() => void commitImport(item.id, item.version)}
                      >
                        确认 IMPORT
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ProductPanel>
            <ProductPanel
              aside={<ProductTag tone="good">可校验</ProductTag>}
              description="导出需要近期认证，并提供短期下载与 SHA-256。"
              title="数据导出"
            >
              <p>
                {summary.exports.queued + summary.exports.running} 个处理中，
                {summary.exports.succeeded} 个成功，{summary.exports.failed}{" "}
                个失败。
              </p>
              <form className="planning-form" onSubmit={createExport}>
                <label>
                  输入 EXPORT 确认创建
                  <input name="confirmation" pattern="EXPORT" required />
                </label>
                <button>创建加密导出</button>
              </form>
              <ul className="item-list">
                {data.exports.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.status}</strong>
                      <small>
                        {item.artifact_bytes ?? 0} bytes · 到期时间{" "}
                        {item.expires_at}
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
                      <button
                        type="button"
                        onClick={() => void cancelExport(item.id, item.version)}
                      >
                        取消
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </ProductPanel>
            <ProductPanel
              aside={<ProductTag>审计边界</ProductTag>}
              description="现有权限、显式确认与服务端审计继续生效。"
              title="权限与审计"
            >
              <p>
                Persona 仅决定入口是否可见，不替代 Workspace Role 或 Space
                权限。
              </p>
              <Link className="product-action-link" href="/app/audit">
                查看审计记录
              </Link>
            </ProductPanel>
          </div>
        </>
      ) : null}

      <ProductPanel
        aside={<ProductTag tone="warn">尚未支持</ProductTag>}
        description="以下能力需要独立的凭据存储、授权、审计与后台调度设计；本页不会伪造连接状态。"
        title="通用连接器与自动化"
      >
        <div className="product-card-grid">
          <article className="product-compact-card">
            <h3>第三方账号连接</h3>
            <p>Zotero 账号同步与 OAuth 尚未开放。</p>
          </article>
          <article className="product-compact-card">
            <h3>Webhook</h3>
            <p>入站与出站投递尚未开放。</p>
          </article>
          <article className="product-compact-card">
            <h3>MCP / API Token</h3>
            <p>创建、轮换、撤销与能力授权尚未开放。</p>
          </article>
          <article className="product-compact-card">
            <h3>自动化规则</h3>
            <p>触发器、执行器、重试与运行历史尚未开放。</p>
          </article>
        </div>
      </ProductPanel>
    </main>
  );
}
