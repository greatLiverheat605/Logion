"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  "listCalendarFeeds" | "listWorkspaces" | "loadPortability"
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
    setWorkspaceId(nextWorkspaceId);
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
              <Link className="product-action-link" href="/app/search">
                管理日历订阅
              </Link>
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
              <Link className="product-action-link" href="/app/data">
                预览导入内容
              </Link>
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
              <Link className="product-action-link" href="/app/data">
                管理导出任务
              </Link>
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
